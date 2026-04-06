import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  AUTO_UPDATE_PLUGIN_SPEC,
  buildOpencodeConfig,
  buildProviderChoices,
  persistInitFiles,
  extractAuthenticatedProviderIds,
  updatePluginList,
  validateModelId,
} from "../src/init-opencode"
import type { WorkloadRouterConfig } from "../src/types"

const originalConfigHome = process.env.XDG_CONFIG_HOME
const originalDataHome = process.env.XDG_DATA_HOME

afterEach(() => {
  process.env.XDG_CONFIG_HOME = originalConfigHome
  process.env.XDG_DATA_HOME = originalDataHome
})

describe("extractAuthenticatedProviderIds", () => {
  it("reads provider ids from auth.json-style data", () => {
    expect(extractAuthenticatedProviderIds({
      openai: { type: "oauth" },
      google: { type: "oauth" },
      anthropic: { type: "oauth" },
    })).toEqual(["openai", "google", "anthropic"])
  })

  it("returns an empty list for invalid auth payloads", () => {
    expect(extractAuthenticatedProviderIds(null)).toEqual([])
    expect(extractAuthenticatedProviderIds([])).toEqual([])
    expect(extractAuthenticatedProviderIds({ openai: "oauth" })).toEqual([])
  })
})

describe("buildProviderChoices", () => {
  it("uses authenticated providers when they are available", () => {
    expect(buildProviderChoices(["google", "custom-auth"])).toEqual([
      { value: "google", label: "Google (Gemini)" },
      { value: "custom-auth", label: "custom-auth" },
    ])
  })

  it("falls back to the known provider catalog when detection is empty", () => {
    expect(buildProviderChoices([]).map(choice => choice.value)).toEqual([
      "anthropic",
      "openai",
      "google",
      "xai",
      "github-copilot",
      "opencode",
    ])
  })
})

describe("validateModelId", () => {
  it("accepts plain model ids without provider prefixes", () => {
    expect(validateModelId("gpt-5.4")).toBeUndefined()
  })

  it("rejects empty model ids or provider/model refs", () => {
    expect(validateModelId(""))?.toContain("required")
    expect(validateModelId("openai/gpt-5.4"))?.toContain("model ID")
  })
})

describe("updatePluginList", () => {
  it("adds the auto-update plugin spec when missing", () => {
    expect(updatePluginList(["oh-my-openagent@latest"])).toEqual([
      "oh-my-openagent@latest",
      AUTO_UPDATE_PLUGIN_SPEC,
    ])
  })

  it("normalizes an existing plugin entry to @latest without duplication", () => {
    expect(updatePluginList([
      "opencode-workload-router",
      "oh-my-openagent@latest",
    ])).toEqual([
      AUTO_UPDATE_PLUGIN_SPEC,
      "oh-my-openagent@latest",
    ])
  })

  it("deduplicates repeated workload-router entries", () => {
    expect(updatePluginList([
      "opencode-workload-router",
      "opencode-workload-router@latest",
      "oh-my-openagent@latest",
    ])).toEqual([
      AUTO_UPDATE_PLUGIN_SPEC,
      "oh-my-openagent@latest",
    ])
  })
})

describe("buildOpencodeConfig", () => {
  it("preserves existing config fields while updating the plugin array", () => {
    expect(buildOpencodeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: ["oh-my-openagent@latest", "opencode-workload-router"],
      provider: { openai: { models: {} } },
    })).toEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: ["oh-my-openagent@latest", AUTO_UPDATE_PLUGIN_SPEC],
      provider: { openai: { models: {} } },
    })
  })

  it("creates a minimal config when opencode.json does not exist yet", () => {
    expect(buildOpencodeConfig(undefined)).toEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: [AUTO_UPDATE_PLUGIN_SPEC],
    })
  })
})

describe("persistInitFiles", () => {
  function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  }

  function makeWorkloadConfig(): WorkloadRouterConfig {
    return {
      enabled: true,
      provider_priority: ["openai"],
      exclude_agents: [],
      intercept_tools: ["task", "agent", "subtask", "delegate_task", "call_omo_agent"],
    }
  }

  it("writes opencode.json and workload-router.json on success", () => {
    const configHome = makeTempDir("router-config-")
    const dataHome = makeTempDir("router-data-")
    process.env.XDG_CONFIG_HOME = configHome
    process.env.XDG_DATA_HOME = dataHome

    const result = persistInitFiles(makeWorkloadConfig())

    expect(fs.existsSync(result.opencodeConfigPath)).toBe(true)
    expect(fs.existsSync(result.workloadRouterConfigPath)).toBe(true)
  })

  it("does not write workload-router.json if opencode.json is invalid", () => {
    const configHome = makeTempDir("router-config-")
    const dataHome = makeTempDir("router-data-")
    process.env.XDG_CONFIG_HOME = configHome
    process.env.XDG_DATA_HOME = dataHome

    const opencodeDir = path.join(configHome, "opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(path.join(opencodeDir, "opencode.json"), "{not valid json", "utf-8")

    expect(() => persistInitFiles(makeWorkloadConfig())).toThrow(/Invalid JSON/)
    expect(fs.existsSync(path.join(opencodeDir, "workload-router.json"))).toBe(false)
  })
})
