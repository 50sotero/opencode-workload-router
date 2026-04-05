import { describe, it, expect } from "vitest"
import { resolveTiers } from "../src/tier-resolver"
import type { TierMap, WorkloadRouterConfig } from "../src/types"

// Minimal mock provider data matching the SDK's ProviderListResponse shape
function makeProvider(id: string, models: Record<string, {
  toolcall: boolean
  reasoning: boolean
  context: number
  cost?: { input: number; output: number }
}>) {
  return {
    id,
    name: id,
    env: [],
    models: Object.fromEntries(
      Object.entries(models).map(([modelId, caps]) => [
        modelId,
        {
          id: modelId,
          name: modelId,
          release_date: "2026-01-01",
          attachment: false,
          reasoning: caps.reasoning,
          temperature: true,
          tool_call: caps.toolcall,
          cost: caps.cost ? {
            input: caps.cost.input,
            output: caps.cost.output,
          } : undefined,
          limit: { context: caps.context, output: 8192 },
          options: {},
        },
      ])
    ),
  }
}

describe("resolveTiers", () => {
  it("resolves all 4 tiers from a single provider", () => {
    const providers = [
      makeProvider("anthropic", {
        "claude-haiku-4-5": { toolcall: true, reasoning: false, context: 200000 },
        "claude-sonnet-4-6": { toolcall: true, reasoning: true, context: 200000 },
        "claude-opus-4-6": { toolcall: true, reasoning: true, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const result = resolveTiers(providers, connected, ["anthropic"], undefined)

    expect(result["tier-1"]).toEqual({ providerID: "anthropic", modelID: "claude-haiku-4-5" })
    expect(result["tier-2"]?.providerID).toBe("anthropic")
    expect(result["tier-3"]?.providerID).toBe("anthropic")
    expect(result["tier-4"]?.providerID).toBe("anthropic")
  })

  it("respects provider priority order", () => {
    const providers = [
      makeProvider("openai", {
        "gpt-5-nano": { toolcall: true, reasoning: false, context: 50000 },
        "gpt-5.4": { toolcall: true, reasoning: true, context: 350000 },
      }),
      makeProvider("anthropic", {
        "claude-haiku-4-5": { toolcall: true, reasoning: false, context: 200000 },
        "claude-opus-4-6": { toolcall: true, reasoning: true, context: 200000 },
      }),
    ]
    const connected = ["openai", "anthropic"]

    // Prefer anthropic first
    const result = resolveTiers(providers, connected, ["anthropic", "openai"], undefined)
    expect(result["tier-1"]?.providerID).toBe("anthropic")

    // Prefer openai first
    const result2 = resolveTiers(providers, connected, ["openai", "anthropic"], undefined)
    expect(result2["tier-1"]?.providerID).toBe("openai")
  })

  it("skips disconnected providers", () => {
    const providers = [
      makeProvider("anthropic", {
        "claude-opus-4-6": { toolcall: true, reasoning: true, context: 200000 },
      }),
      makeProvider("openai", {
        "gpt-5-nano": { toolcall: true, reasoning: false, context: 50000 },
      }),
    ]
    const connected = ["openai"] // anthropic not connected
    const result = resolveTiers(providers, connected, ["anthropic", "openai"], undefined)
    expect(result["tier-1"]?.providerID).toBe("openai")
  })

  it("applies tier_overrides over auto-detection", () => {
    const providers = [
      makeProvider("anthropic", {
        "claude-haiku-4-5": { toolcall: true, reasoning: false, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const overrides: Record<string, { model: string; variant?: string }> = {
      "tier-1": { model: "openai/gpt-5-nano" },
    }
    const result = resolveTiers(providers, connected, ["anthropic"], overrides as WorkloadRouterConfig["tier_overrides"])
    expect(result["tier-1"]).toEqual({ providerID: "openai", modelID: "gpt-5-nano" })
  })

  it("returns empty map when no providers are connected", () => {
    const result = resolveTiers([], [], ["anthropic"], undefined)
    expect(result).toEqual({})
  })

  it("falls back tier to next tier up when no model fits", () => {
    // Only a high-capability model available — tier-1 and tier-2 should fall up
    const providers = [
      makeProvider("anthropic", {
        "claude-opus-4-6": { toolcall: true, reasoning: true, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const result = resolveTiers(providers, connected, ["anthropic"], undefined)
    // tier-1 has no non-reasoning model, should fall up to opus
    expect(result["tier-1"]?.modelID).toBe("claude-opus-4-6")
  })
})
