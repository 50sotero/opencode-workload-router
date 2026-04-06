import { describe, it, expect } from "vitest"
import { buildInitConfig, validateModelRef } from "../src/init-config"

describe("buildInitConfig", () => {
  it("builds single-provider routing config from one provider", () => {
    const config = buildInitConfig({
      routingMode: "single-provider",
      singleProvider: "openai",
      classifierModel: "",
      excludeAgents: ["sisyphus"],
    })

    expect(config).toEqual({
      classifier_model: undefined,
      enabled: true,
      provider_priority: ["openai"],
      exclude_agents: ["sisyphus"],
      intercept_tools: ["task", "agent", "subtask", "delegate_task", "call_omo_agent"],
      tier_overrides: undefined,
    })
  })

  it("builds multi-provider routing config preserving priority order", () => {
    const config = buildInitConfig({
      routingMode: "multi-provider",
      providerPriority: ["google", "openai", "anthropic"],
      classifierModel: "openai/gpt-5-nano",
      excludeAgents: [],
    })

    expect(config.provider_priority).toEqual(["google", "openai", "anthropic"])
    expect(config.classifier_model).toBe("openai/gpt-5-nano")
    expect(config.tier_overrides).toBeUndefined()
  })

  it("builds cross-provider model config with tier overrides and derived provider priority", () => {
    const config = buildInitConfig({
      routingMode: "manual-tier-models",
      tierOverrides: {
        "tier-1": { model: "openai/gpt-5-nano" },
        "tier-2": { model: "google/gemini-2.5-flash" },
        "tier-3": { model: "google/gemini-2.5-pro" },
        "tier-4": { model: "openai/gpt-5.4", variant: "xhigh" },
      },
      classifierModel: "",
      excludeAgents: ["prometheus"],
    })

    expect(config.provider_priority).toEqual(["openai", "google"])
    expect(config.tier_overrides).toEqual({
      "tier-1": { model: "openai/gpt-5-nano" },
      "tier-2": { model: "google/gemini-2.5-flash" },
      "tier-3": { model: "google/gemini-2.5-pro" },
      "tier-4": { model: "openai/gpt-5.4", variant: "xhigh" },
    })
    expect(config.exclude_agents).toEqual(["prometheus"])
  })
})

describe("validateModelRef", () => {
  it("accepts provider/model strings", () => {
    expect(validateModelRef("openai/gpt-5.4")).toBeUndefined()
  })

  it("rejects strings without a provider prefix", () => {
    expect(validateModelRef("gpt-5.4")).toContain("provider/model")
  })

  it("rejects empty model refs", () => {
    expect(validateModelRef(""))?.toContain("required")
  })
})
