import { describe, it, expect } from "vitest"
import {
  createChatMessageHook,
  createSessionModelOverrideStore,
  parseOneShotInstruction,
} from "../src/session-overrides"

const providers = [
  {
    id: "openai",
    models: {
      "gpt-5.2-codex": { id: "gpt-5.2-codex" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex" },
      "gpt-5.3-codex-spark": { id: "gpt-5.3-codex-spark" },
      "gpt-5.4": { id: "gpt-5.4" },
    },
  },
  {
    id: "google",
    models: {
      "gemini-2.5-pro": { id: "gemini-2.5-pro" },
    },
  },
]

describe("createChatMessageHook", () => {
  it("stores a session override from a natural-language prompt", async () => {
    const store = createSessionModelOverrideStore()
    const hook = createChatMessageHook(store, providers, ["openai", "google"], ["openai", "google"])

    await hook(
      { sessionID: "session-1" },
      {
        message: {} as never,
        parts: [{ type: "text", text: "from now on, use gpt 5.3 codex for future subagent deployments" } as never],
      },
    )

    expect(store.get("session-1")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    })
  })

  it("clears an existing override when the user asks to resume workload routing", async () => {
    const store = createSessionModelOverrideStore()
    store.set("session-1", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const hook = createChatMessageHook(store, providers, ["openai", "google"], ["openai", "google"])

    await hook(
      { sessionID: "session-1" },
      {
        message: {} as never,
        parts: [{ type: "text", text: "go back to workload routing for future subagent deployments" } as never],
      },
    )

    expect(store.get("session-1")).toBeUndefined()
  })

  it("ignores quoted examples inside longer product discussions", async () => {
    const store = createSessionModelOverrideStore()
    const hook = createChatMessageHook(store, providers, ["openai", "google"], ["openai", "google"])

    await hook(
      { sessionID: "session-1" },
      {
        message: {} as never,
        parts: [{
          type: "text",
          text: 'Can you make the router accept prompts like "from now on, use gpt 5.3 codex for future subagent deployments"?',
        } as never],
      },
    )

    expect(store.get("session-1")).toBeUndefined()
  })
})

describe("parseOneShotInstruction", () => {
  it("parses 'spawn a subagent with <model> <variant> and <task>'", () => {
    const result = parseOneShotInstruction(
      "spawn a subagent with gpt 5.2 codex low and make it say hello world only",
    )
    expect(result).toEqual({
      modelQuery: "gpt 5.2 codex",
      variant: "low",
      taskText: "make it say hello world only",
    })
  })

  it("parses 'use <model> <variant> for this subagent and <task>'", () => {
    const result = parseOneShotInstruction(
      "use gemini 2.5 pro high for this subagent and refactor the auth module",
    )
    expect(result).toEqual({
      modelQuery: "gemini 2.5 pro",
      variant: "high",
      taskText: "refactor the auth module",
    })
  })

  it("parses without variant when last token is not a known variant", () => {
    const result = parseOneShotInstruction(
      "spawn a subagent with gpt 5.4 and debug the login flow",
    )
    expect(result).toEqual({
      modelQuery: "gpt 5.4",
      variant: undefined,
      taskText: "debug the login flow",
    })
  })

  it("returns null for persistent override phrasing", () => {
    const result = parseOneShotInstruction(
      "from now on, use gpt 5.2 codex for future subagent deployments",
    )
    expect(result).toBeNull()
  })

  it("returns null for plain task prompts", () => {
    const result = parseOneShotInstruction("find all TODO comments in src/")
    expect(result).toBeNull()
  })

  it("supports 'for the next subagent' phrasing", () => {
    const result = parseOneShotInstruction(
      "use gpt 5.4 xhigh for the next subagent and architect a caching layer",
    )
    expect(result).toEqual({
      modelQuery: "gpt 5.4",
      variant: "xhigh",
      taskText: "architect a caching layer",
    })
  })
})

describe("one-shot override via chat.message hook", () => {
  it("stores a one-shot override that does NOT create a persistent override", async () => {
    const store = createSessionModelOverrideStore()
    const hook = createChatMessageHook(store, providers, ["openai", "google"], ["openai", "google"])

    await hook(
      { sessionID: "session-1" },
      {
        message: {} as never,
        parts: [{
          type: "text",
          text: "spawn a subagent with gpt 5.2 codex low and make it say hello world only",
        } as never],
      },
    )

    // No persistent override should be stored
    expect(store.get("session-1")).toBeUndefined()
    // One-shot override should be stored
    const oneShot = store.getOneShot("session-1")
    expect(oneShot).toBeDefined()
    expect(oneShot?.providerID).toBe("openai")
    expect(oneShot?.variant).toBe("low")
  })

  it("consumeOneShot returns and clears the one-shot", () => {
    const store = createSessionModelOverrideStore()
    store.setOneShot("session-1", { providerID: "openai", modelID: "gpt-5.4", variant: "xhigh" })

    const consumed = store.consumeOneShot("session-1")
    expect(consumed).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "xhigh" })

    // Should be gone after consuming
    expect(store.getOneShot("session-1")).toBeUndefined()
    expect(store.consumeOneShot("session-1")).toBeUndefined()
  })
})
