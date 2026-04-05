import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { loadConfig, DEFAULT_CONFIG } from "../src/config"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

vi.mock("node:fs")

describe("loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns default config when file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const config = loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it("parses valid config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      provider_priority: ["anthropic", "openai"],
      exclude_agents: ["sisyphus"],
    }))
    const config = loadConfig()
    expect(config.enabled).toBe(true)
    expect(config.provider_priority).toEqual(["anthropic", "openai"])
    expect(config.exclude_agents).toEqual(["sisyphus"])
    expect(config.intercept_tools).toEqual(DEFAULT_CONFIG.intercept_tools)
  })

  it("returns default config and logs warning on invalid JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue("not json{{{")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const config = loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[workload-router]")
    )
  })

  it("returns default config on schema validation failure", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      enabled: "not-a-boolean",
    }))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const config = loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(warnSpy).toHaveBeenCalled()
  })

  it("applies tier_overrides from config", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      provider_priority: ["openai"],
      tier_overrides: {
        "tier-4": { model: "openai/gpt-5.4", variant: "xhigh" }
      },
    }))
    const config = loadConfig()
    expect(config.tier_overrides?.["tier-4"]).toEqual({
      model: "openai/gpt-5.4",
      variant: "xhigh",
    })
  })
})
