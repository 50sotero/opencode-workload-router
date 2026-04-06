import { describe, it, expect } from "vitest"
import {
  createChatMessageHook,
  createSessionModelOverrideStore,
} from "../src/session-overrides"

const providers = [
  {
    id: "openai",
    models: {
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
