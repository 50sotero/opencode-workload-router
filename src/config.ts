import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { z } from "zod"
import type { WorkloadRouterConfig, TierName } from "./types"

const TierOverrideSchema = z.object({
  model: z.string(),
  variant: z.string().optional(),
})

const ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider_priority: z.array(z.string()).default([]),
  classifier_model: z.string().optional(),
  exclude_agents: z.array(z.string()).default([]),
  tier_overrides: z.object({
    "tier-1": TierOverrideSchema.optional(),
    "tier-2": TierOverrideSchema.optional(),
    "tier-3": TierOverrideSchema.optional(),
    "tier-4": TierOverrideSchema.optional(),
  }).optional(),
  intercept_tools: z.array(z.string()).default([
    "agent", "subtask", "delegate_task", "call_omo_agent",
  ]),
})

export const DEFAULT_CONFIG: WorkloadRouterConfig = {
  enabled: false,
  provider_priority: [],
  exclude_agents: [],
  intercept_tools: ["agent", "subtask", "delegate_task", "call_omo_agent"],
}

function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME
    || path.join(os.homedir(), ".config")
  return path.join(configDir, "opencode", "workload-router.json")
}

export function loadConfig(): WorkloadRouterConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  let raw: string
  try {
    raw = fs.readFileSync(configPath, "utf-8")
  } catch {
    console.warn("[workload-router] Failed to read config file")
    return DEFAULT_CONFIG
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn("[workload-router] Invalid JSON in config file")
    return DEFAULT_CONFIG
  }

  const result = ConfigSchema.safeParse(parsed)
  if (!result.success) {
    console.warn("[workload-router] Config validation failed:", result.error.message)
    return DEFAULT_CONFIG
  }

  return result.data as WorkloadRouterConfig
}
