import { describe, it, expect, vi } from "vitest"
import { createInterceptor } from "../src/interceptor"
import { createSessionModelOverrideStore } from "../src/session-overrides"
import type { TierMap, WorkloadRouterConfig } from "../src/types"

const baseTierMap: TierMap = {
  "tier-1": { providerID: "openai", modelID: "gpt-5-nano" },
  "tier-2": { providerID: "openai", modelID: "gpt-5.2" },
  "tier-3": { providerID: "openai", modelID: "gpt-5.4" },
  "tier-4": { providerID: "openai", modelID: "gpt-5.4", variant: "xhigh" },
}

const baseConfig: WorkloadRouterConfig = {
  enabled: true,
  provider_priority: ["anthropic", "openai"],
  exclude_agents: ["sisyphus"],
  intercept_tools: ["task", "agent", "subtask", "delegate_task"],
}

describe("createInterceptor", () => {
  it("ignores non-subagent tools", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { command: "ls -la" } }
    await interceptor({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    expect(output.args).toEqual({ command: "ls -la" })
  })

  it("rewrites model for subagent tool based on tier tag", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { prompt: "[tier-1] find all TODO comments", agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5-nano",
    })
  })

  it("does not rewrite for excluded agents", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { prompt: "[tier-1] quick task", agent: "sisyphus" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toBeUndefined()
  })

  it("does not rewrite excluded built-in task subagents", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { prompt: "[tier-1] quick task", subagent_type: "sisyphus" } }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toBeUndefined()
  })

  it("uses heuristic when no tier tag present", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { prompt: "grep for all auth imports", agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5-nano",
    })
  })

  it("falls back to small-model classifier when heuristic is ambiguous", async () => {
    const mockClassify = vi.fn().mockResolvedValue("tier-2")
    const interceptor = createInterceptor(baseConfig, baseTierMap, mockClassify)
    const output = { args: { prompt: "work on the user profile page", agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(mockClassify).toHaveBeenCalled()
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.2",
    })
  })

  it("defaults to tier-3 when classifier returns null", async () => {
    const mockClassify = vi.fn().mockResolvedValue(null)
    const interceptor = createInterceptor(baseConfig, baseTierMap, mockClassify)
    const output = { args: { prompt: "work on the user profile page", agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
  })

  it("defaults to tier-3 when no classifier provided and heuristic is ambiguous", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { prompt: "work on the user profile page", agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
  })

  it("uses a remembered session override before heuristic classification", async () => {
    const overrides = createSessionModelOverrideStore()
    overrides.set("s1", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const mockClassify = vi.fn().mockResolvedValue("tier-1")
    const interceptor = createInterceptor(baseConfig, baseTierMap, mockClassify, overrides)
    const output = {
      args: {
        prompt: "work on the user profile page",
        description: "profile task",
        subagent_type: "explore",
      },
    }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c1" }, output)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    })
  })

  it("handles missing prompt in args gracefully", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toBeUndefined()
  })

  it("consumes a one-shot override with variant on the next subagent call", async () => {
    const overrides = createSessionModelOverrideStore()
    overrides.setOneShot("s1", { providerID: "openai", modelID: "gpt-5.2", variant: "low" })
    const mockClassify = vi.fn().mockResolvedValue("tier-1")
    const interceptor = createInterceptor(baseConfig, baseTierMap, mockClassify, overrides)
    const output = {
      args: { prompt: "work on the user profile page", subagent_type: "explore" },
    }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c1" }, output)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.2",
      variant: "low",
    })
    // One-shot should be consumed — gone after use
    expect(overrides.getOneShot("s1")).toBeUndefined()
  })

  it("falls back to tier routing after a one-shot is consumed", async () => {
    const overrides = createSessionModelOverrideStore()
    overrides.setOneShot("s1", { providerID: "openai", modelID: "gpt-5.2", variant: "low" })
    const interceptor = createInterceptor(baseConfig, baseTierMap, null, overrides)

    // First call consumes the one-shot
    const output1 = { args: { prompt: "[tier-1] first task", subagent_type: "explore" } }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c1" }, output1)
    expect(output1.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.2",
      variant: "low",
    })

    // Second call should fall through to tier routing (no one-shot left)
    const output2 = { args: { prompt: "[tier-1] second task", subagent_type: "explore" } }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c2" }, output2)
    expect(output2.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5-nano",
    })
  })

  it("one-shot takes priority over persistent session override", async () => {
    const overrides = createSessionModelOverrideStore()
    overrides.set("s1", { providerID: "google", modelID: "gemini-pro" })
    overrides.setOneShot("s1", { providerID: "openai", modelID: "gpt-5.4", variant: "xhigh" })
    const interceptor = createInterceptor(baseConfig, baseTierMap, null, overrides)
    const output = { args: { prompt: "important task", subagent_type: "explore" } }
    await interceptor({ tool: "task", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "xhigh",
    })
    // Persistent override should still be there for next call
    expect(overrides.get("s1")).toEqual({ providerID: "google", modelID: "gemini-pro" })
  })
})
