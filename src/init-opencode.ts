import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { WorkloadRouterConfig } from "./types.js"

export const AUTO_UPDATE_PLUGIN_SPEC = "opencode-workload-router@latest"

const KNOWN_PROVIDER_CHOICES = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "xai", label: "xAI (Grok)" },
  { value: "github-copilot", label: "GitHub Copilot" },
  { value: "opencode", label: "OpenCode" },
] as const

export type ProviderChoice = { value: string; label: string }

function getConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

function getDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
}

export function getOpencodeConfigPath(): string {
  return path.join(getConfigHome(), "opencode", "opencode.json")
}

export function getOpencodeAuthPath(): string {
  return path.join(getDataHome(), "opencode", "auth.json")
}

export function getWorkloadRouterConfigPath(): string {
  return path.join(getConfigHome(), "opencode", "workload-router.json")
}

export function extractAuthenticatedProviderIds(authData: unknown): string[] {
  if (!authData || typeof authData !== "object" || Array.isArray(authData)) {
    return []
  }

  return Object.entries(authData)
    .filter(([, value]) => value != null && typeof value === "object" && !Array.isArray(value))
    .map(([providerId]) => providerId)
}

export function loadAuthenticatedProviderIds(): string[] {
  const authPath = getOpencodeAuthPath()
  if (!fs.existsSync(authPath)) {
    return []
  }

  try {
    const raw = fs.readFileSync(authPath, "utf-8")
    return extractAuthenticatedProviderIds(JSON.parse(raw))
  } catch {
    return []
  }
}

export function buildProviderChoices(authenticatedProviderIds: string[]): ProviderChoice[] {
  if (authenticatedProviderIds.length === 0) {
    return KNOWN_PROVIDER_CHOICES.map(choice => ({ ...choice }))
  }

  return authenticatedProviderIds.map((providerId) => {
    const known = KNOWN_PROVIDER_CHOICES.find(choice => choice.value === providerId)
    return known ? { ...known } : { value: providerId, label: providerId }
  })
}

export function validateModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return "Model ID is required"
  if (trimmed.includes("/")) return "Enter only the model ID; provider is chosen separately"
  return undefined
}

export function updatePluginList(pluginList: unknown): string[] {
  const existing = Array.isArray(pluginList)
    ? pluginList.filter((entry): entry is string => typeof entry === "string")
    : []

  let replaced = false
  const seen = new Set<string>()
  const updated: string[] = []

  for (const entry of existing) {
    if (entry === "opencode-workload-router" || entry.startsWith("opencode-workload-router@")) {
      replaced = true
      if (!seen.has(AUTO_UPDATE_PLUGIN_SPEC)) {
        updated.push(AUTO_UPDATE_PLUGIN_SPEC)
        seen.add(AUTO_UPDATE_PLUGIN_SPEC)
      }
      continue
    }

    if (!seen.has(entry)) {
      updated.push(entry)
      seen.add(entry)
    }
  }

  if (!replaced) {
    updated.push(AUTO_UPDATE_PLUGIN_SPEC)
  }

  return updated
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function buildOpencodeConfig(existingConfig: unknown): Record<string, unknown> {
  const base = isRecord(existingConfig) ? { ...existingConfig } : {}
  const schema = typeof base.$schema === "string" ? base.$schema : "https://opencode.ai/config.json"

  return {
    ...base,
    $schema: schema,
    plugin: updatePluginList(base.plugin),
  }
}

export function ensureAutoUpdatePluginRegistration(): string {
  const configPath = getOpencodeConfigPath()
  const configDir = path.dirname(configPath)

  let existing: unknown
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch {
      throw new Error(`Invalid JSON in ${configPath}`)
    }
  }

  const nextConfig = buildOpencodeConfig(existing)

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8")
  return configPath
}

export function writeWorkloadRouterConfig(config: WorkloadRouterConfig): string {
  const configPath = getWorkloadRouterConfigPath()
  const configDir = path.dirname(configPath)

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
  return configPath
}

export function persistInitFiles(config: WorkloadRouterConfig): {
  opencodeConfigPath: string
  workloadRouterConfigPath: string
} {
  const opencodeConfigPath = ensureAutoUpdatePluginRegistration()
  const workloadRouterConfigPath = writeWorkloadRouterConfig(config)

  return {
    opencodeConfigPath,
    workloadRouterConfigPath,
  }
}
