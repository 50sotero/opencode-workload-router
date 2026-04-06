# Workload Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone OpenCode plugin that intercepts subagent spawns and rewrites the model based on 4-tier workload classification, with auto-detection of best available models per tier from connected providers.

**Architecture:** The plugin uses `tool.execute.before` to intercept subagent tool calls, classifies the task via a 3-level priority chain (main agent tier tag > heuristic > small-model classifier), resolves the tier to an auto-detected model, and rewrites the tool args. System prompt injection via `experimental.chat.system.transform` teaches the main agent to tag delegations with tier hints.

**Tech Stack:** TypeScript, `@opencode-ai/plugin` SDK, `@opencode-ai/sdk`, zod 4, Vitest, `@clack/prompts` (init CLI)

---

## Planned File Structure

```
opencode-workload-router/
  src/
    index.ts              — Plugin entry, exports WorkloadRouter, wires hooks
    config.ts             — Load workload-router.json, validate with zod schema
    tier-resolver.ts      — Query providers, fill tier→model map by capability bracket
    heuristic.ts          — Keyword/token heuristic → { tier, confidence }
    classifier.ts         — Small-model LLM call for ambiguous prompts
    interceptor.ts        — tool.execute.before logic: detect subagent, classify, rewrite
    system-prompt.ts      — experimental.chat.system.transform: inject tier instructions
    types.ts              — Shared types: TierName, TierMap, ResolvedModel, HeuristicResult, Config
  bin/
    init.ts               — npx opencode-workload-router init CLI
  tests/
    config.test.ts
    heuristic.test.ts
    classifier.test.ts
    tier-resolver.test.ts
    interceptor.test.ts
    system-prompt.test.ts
  package.json
  tsconfig.json
  README.md
```

---

## Task 1: Scaffold the Plugin Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "opencode-workload-router",
  "version": "0.1.0",
  "description": "OpenCode plugin that auto-routes subagents to tiered models based on workload classification",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "opencode-workload-router": "./dist/bin/init.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["opencode", "plugin", "model-routing", "subagent", "workload", "tier"],
  "license": "MIT",
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.2.0"
  },
  "dependencies": {
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.2.20",
    "@opencode-ai/sdk": "^1.2.20",
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "bin/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create src/types.ts with all shared types**

```typescript
export type TierName = "tier-1" | "tier-2" | "tier-3" | "tier-4"

export const TIER_NAMES: TierName[] = ["tier-1", "tier-2", "tier-3", "tier-4"]

export type ResolvedModel = {
  providerID: string
  modelID: string
  variant?: string
}

export type TierMap = Partial<Record<TierName, ResolvedModel>>

export type HeuristicResult = {
  tier: TierName
  confidence: "high" | "low"
}

export type WorkloadRouterConfig = {
  enabled: boolean
  provider_priority: string[]
  classifier_model?: string
  exclude_agents: string[]
  tier_overrides?: Partial<Record<TierName, { model: string; variant?: string }>>
  intercept_tools: string[]
}
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: Clean install, no errors.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: Zero errors.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json src/types.ts
git commit -m "chore: scaffold workload router plugin package"
```

---

## Task 2: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for config loading**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: Failures — `loadConfig` and `DEFAULT_CONFIG` not found.

- [ ] **Step 3: Implement config.ts**

```typescript
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
  tier_overrides: z.record(
    z.enum(["tier-1", "tier-2", "tier-3", "tier-4"]),
    TierOverrideSchema,
  ).optional(),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader with zod validation"
```

---

## Task 3: Heuristic Classifier

**Files:**
- Create: `src/heuristic.ts`
- Create: `tests/heuristic.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest"
import { classifyHeuristic } from "../src/heuristic"

describe("classifyHeuristic", () => {
  describe("tier-1: trivial tasks", () => {
    it("classifies short prompts with no code as tier-1", () => {
      const result = classifyHeuristic("find all TODO comments")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies grep/search tasks as tier-1", () => {
      const result = classifyHeuristic("grep for all imports of auth module")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies explain requests as tier-1", () => {
      const result = classifyHeuristic("what is this function doing?")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies list/read tasks as tier-1", () => {
      const result = classifyHeuristic("list all files in src/utils")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })
  })

  describe("tier-2: standard tasks", () => {
    it("classifies single-file edits as tier-2", () => {
      const result = classifyHeuristic("fix the typo in src/config.ts")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })

    it("classifies test writing as tier-2", () => {
      const result = classifyHeuristic("write a test for the parseConfig function")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })

    it("classifies rename tasks as tier-2", () => {
      const result = classifyHeuristic("rename the variable foo to barCount in utils.ts")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })
  })

  describe("tier-3: heavy tasks", () => {
    it("classifies multi-file refactors as tier-3", () => {
      const result = classifyHeuristic("refactor the auth module across all files")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })

    it("classifies debugging tasks as tier-3", () => {
      const result = classifyHeuristic("debug why the login flow fails on redirect")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })

    it("classifies feature implementation as tier-3", () => {
      const result = classifyHeuristic("implement pagination for the user list endpoint")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })
  })

  describe("tier-4: critical tasks", () => {
    it("classifies architecture tasks as tier-4", () => {
      const result = classifyHeuristic("architect a distributed caching layer from scratch")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })

    it("classifies long prompts with design language as tier-4", () => {
      const longPrompt = "Design a new authentication system that supports OAuth2, SAML, and API keys. " +
        "It needs to handle distributed sessions across multiple regions with consistent hashing. " +
        "The system should support rate limiting per tenant and have a migration path from the current JWT-based auth. " +
        "Consider security implications including token rotation, revocation, and audit logging. " +
        "```typescript\ninterface AuthProvider {\n  authenticate(token: string): Promise<Session>\n  refresh(session: Session): Promise<Session>\n}\n```" +
        "The infrastructure should be horizontally scalable and support blue-green deployments."
      const result = classifyHeuristic(longPrompt)
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })
  })

  describe("ambiguous prompts", () => {
    it("returns low confidence for ambiguous prompts", () => {
      const result = classifyHeuristic("work on the user profile page")
      expect(result.confidence).toBe("low")
    })

    it("returns low confidence for medium-length prompts without clear signals", () => {
      const result = classifyHeuristic("update the configuration to handle the new format properly")
      expect(result.confidence).toBe("low")
    })
  })

  describe("tier tag extraction", () => {
    it("extracts explicit tier-1 tag", () => {
      const result = classifyHeuristic("[tier-1] find all TODO comments")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("extracts explicit tier-4 tag", () => {
      const result = classifyHeuristic("[tier-4] redesign the auth system")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })

    it("tier tag takes priority over heuristic", () => {
      const result = classifyHeuristic("[tier-4] fix a typo")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/heuristic.test.ts`
Expected: Failures — `classifyHeuristic` not found.

- [ ] **Step 3: Implement heuristic.ts**

```typescript
import type { TierName, HeuristicResult } from "./types"

const TIER_TAG_PATTERN = /^\[tier-([1-4])\]\s*/i

const TIER_1_VERBS = [
  "grep", "find", "read", "list", "search", "look", "check",
  "what is", "what does", "explain", "show", "print", "count",
  "where is", "how many",
]

const TIER_2_VERBS = [
  "edit", "fix", "rename", "add", "remove", "update", "test",
  "write test", "change", "replace", "move", "delete", "insert",
]

const TIER_3_KEYWORDS = [
  "refactor", "debug", "implement", "feature", "integrate", "migrate",
  "across", "all files", "project-wide", "multiple files", "codebase",
]

const TIER_4_KEYWORDS = [
  "architect", "design", "system", "infrastructure", "migration",
  "from scratch", "distributed", "scalable", "security audit",
  "performance", "redesign", "overhaul",
]

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3)
}

function hasCodeBlocks(text: string): boolean {
  return CODE_BLOCK_PATTERN.test(text)
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw))
}

export function classifyHeuristic(prompt: string): HeuristicResult {
  // 1. Check for explicit tier tag from main agent
  const tagMatch = prompt.match(TIER_TAG_PATTERN)
  if (tagMatch) {
    const tierNum = tagMatch[1] as "1" | "2" | "3" | "4"
    return { tier: `tier-${tierNum}` as TierName, confidence: "high" }
  }

  const lower = prompt.toLowerCase()
  const tokens = estimateTokens(prompt)
  const hasCode = hasCodeBlocks(prompt)

  // 2. Check tier-4 signals: long + code + design language
  if (tokens > 500 && hasCode && matchesAny(prompt, TIER_4_KEYWORDS)) {
    return { tier: "tier-4", confidence: "high" }
  }

  // 3. Check tier-4: architecture keywords
  if (matchesAny(prompt, TIER_4_KEYWORDS)) {
    const matchCount = TIER_4_KEYWORDS.filter(kw => lower.includes(kw)).length
    if (matchCount >= 2) {
      return { tier: "tier-4", confidence: "high" }
    }
  }

  // 4. Check tier-3: multi-file or complex keywords
  if (matchesAny(prompt, TIER_3_KEYWORDS)) {
    return { tier: "tier-3", confidence: "high" }
  }

  // 5. Check tier-1: short, no code, read-only verbs
  if (tokens < 50 && !hasCode && !matchesAny(prompt, TIER_3_KEYWORDS) && !matchesAny(prompt, TIER_4_KEYWORDS)) {
    if (matchesAny(prompt, TIER_1_VERBS)) {
      return { tier: "tier-1", confidence: "high" }
    }
  }

  // 6. Check tier-1: read-only verbs dominate
  if (matchesAny(prompt, TIER_1_VERBS) && !matchesAny(prompt, TIER_2_VERBS) && !matchesAny(prompt, TIER_3_KEYWORDS)) {
    return { tier: "tier-1", confidence: "high" }
  }

  // 7. Check tier-2: single-file edit verbs
  if (matchesAny(prompt, TIER_2_VERBS) && !matchesAny(prompt, TIER_3_KEYWORDS)) {
    return { tier: "tier-2", confidence: "high" }
  }

  // 8. Ambiguous
  return { tier: "tier-3", confidence: "low" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/heuristic.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/heuristic.ts tests/heuristic.test.ts
git commit -m "feat: add heuristic classifier with tier tag extraction"
```

---

## Task 4: Tier Resolver

**Files:**
- Create: `src/tier-resolver.ts`
- Create: `tests/tier-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
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
        "lite-model": { toolcall: true, reasoning: false, context: 200000 },
        "reasoning-model": { toolcall: true, reasoning: true, context: 200000 },
        "max-model": { toolcall: true, reasoning: true, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const result = resolveTiers(providers, connected, ["anthropic"], undefined)

    expect(result["tier-1"]).toEqual({ providerID: "anthropic", modelID: "lite-model" })
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
        "lite-model": { toolcall: true, reasoning: false, context: 200000 },
        "max-model": { toolcall: true, reasoning: true, context: 200000 },
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
        "max-model": { toolcall: true, reasoning: true, context: 200000 },
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
        "lite-model": { toolcall: true, reasoning: false, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const overrides = {
      "tier-1" as const: { model: "openai/gpt-5-nano" },
    }
    const result = resolveTiers(providers, connected, ["anthropic"], overrides)
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
        "max-model": { toolcall: true, reasoning: true, context: 200000 },
      }),
    ]
    const connected = ["anthropic"]
    const result = resolveTiers(providers, connected, ["anthropic"], undefined)
    // tier-1 has no non-reasoning model, should fall up to opus
    expect(result["tier-1"]?.modelID).toBe("max-model")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tier-resolver.test.ts`
Expected: Failures — `resolveTiers` not found.

- [ ] **Step 3: Implement tier-resolver.ts**

```typescript
import type { TierName, TierMap, ResolvedModel, WorkloadRouterConfig } from "./types"
import { TIER_NAMES } from "./types"

type ProviderModel = {
  id: string
  tool_call: boolean
  reasoning: boolean
  limit: { context: number; output: number }
  cost?: { input: number; output: number }
}

type ProviderData = {
  id: string
  models: Record<string, ProviderModel>
}

function meetsBracket(model: ProviderModel, tier: TierName): boolean {
  if (!model.tool_call) return false

  switch (tier) {
    case "tier-1":
      return true
    case "tier-2":
      return model.reasoning === true
    case "tier-3":
      return model.reasoning === true && model.limit.context >= 100_000
    case "tier-4":
      return model.reasoning === true && model.limit.context >= 200_000
  }
}

function pickBestForTier(
  models: Array<{ providerID: string; model: ProviderModel }>,
  tier: TierName,
): ResolvedModel | undefined {
  const candidates = models.filter(m => meetsBracket(m.model, tier))
  if (candidates.length === 0) return undefined

  if (tier === "tier-1") {
    // Prefer cheapest or least capable (non-reasoning first)
    const nonReasoning = candidates.filter(c => !c.model.reasoning)
    const pool = nonReasoning.length > 0 ? nonReasoning : candidates
    pool.sort((a, b) => (a.model.cost?.input ?? Infinity) - (b.model.cost?.input ?? Infinity))
    return { providerID: pool[0].providerID, modelID: pool[0].model.id }
  }

  if (tier === "tier-4") {
    // Prefer largest context + most capable
    candidates.sort((a, b) => b.model.limit.context - a.model.limit.context)
    return { providerID: candidates[0].providerID, modelID: candidates[0].model.id }
  }

  // tier-2, tier-3: prefer cheapest that meets bracket
  candidates.sort((a, b) => (a.model.cost?.input ?? Infinity) - (b.model.cost?.input ?? Infinity))
  return { providerID: candidates[0].providerID, modelID: candidates[0].model.id }
}

function parseModelOverride(modelStr: string): ResolvedModel {
  const parts = modelStr.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return { providerID: "", modelID: modelStr }
}

export function resolveTiers(
  providers: ProviderData[],
  connectedProviderIds: string[],
  providerPriority: string[],
  tierOverrides: WorkloadRouterConfig["tier_overrides"],
): TierMap {
  const tierMap: TierMap = {}

  // Apply overrides first
  if (tierOverrides) {
    for (const [tier, override] of Object.entries(tierOverrides)) {
      const resolved = parseModelOverride(override.model)
      if (override.variant) resolved.variant = override.variant
      tierMap[tier as TierName] = resolved
    }
  }

  // Collect models from connected providers in priority order
  const connectedSet = new Set(connectedProviderIds)
  const orderedModels: Array<{ providerID: string; model: ProviderModel }>[] = []

  for (const providerId of providerPriority) {
    if (!connectedSet.has(providerId)) continue
    const provider = providers.find(p => p.id === providerId)
    if (!provider) continue

    for (const model of Object.values(provider.models)) {
      orderedModels.push([{ providerID: providerId, model }])
    }
  }

  const allModels = orderedModels.flat()

  // Auto-detect tiers not covered by overrides
  for (const tier of TIER_NAMES) {
    if (tierMap[tier]) continue
    tierMap[tier] = pickBestForTier(allModels, tier)
  }

  // Fallback: fill missing tiers with the next tier up
  for (let i = 0; i < TIER_NAMES.length; i++) {
    if (tierMap[TIER_NAMES[i]]) continue
    for (let j = i + 1; j < TIER_NAMES.length; j++) {
      if (tierMap[TIER_NAMES[j]]) {
        tierMap[TIER_NAMES[i]] = tierMap[TIER_NAMES[j]]
        break
      }
    }
  }

  return tierMap
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tier-resolver.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tier-resolver.ts tests/tier-resolver.test.ts
git commit -m "feat: add tier resolver with auto-detection and provider priority"
```

---

## Task 5: Small-Model Classifier

**Files:**
- Create: `src/classifier.ts`
- Create: `tests/classifier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest"
import { classifyWithModel, CLASSIFIER_SYSTEM_PROMPT } from "../src/classifier"
import type { TierName } from "../src/types"

describe("classifyWithModel", () => {
  it("returns parsed tier from valid model response", async () => {
    const mockSend = vi.fn().mockResolvedValue("tier-2")
    const result = await classifyWithModel("fix the config parser", mockSend)
    expect(result).toBe("tier-2")
    expect(mockSend).toHaveBeenCalledWith(
      CLASSIFIER_SYSTEM_PROMPT,
      "fix the config parser",
    )
  })

  it("trims whitespace from model response", async () => {
    const mockSend = vi.fn().mockResolvedValue("  tier-3\n ")
    const result = await classifyWithModel("implement feature", mockSend)
    expect(result).toBe("tier-3")
  })

  it("returns null on invalid tier response", async () => {
    const mockSend = vi.fn().mockResolvedValue("I think this is a complex task")
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null on empty response", async () => {
    const mockSend = vi.fn().mockResolvedValue("")
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null when send function throws", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("timeout"))
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null when send function times out", async () => {
    const mockSend = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve("tier-1"), 5000))
    )
    const result = await classifyWithModel("do something", mockSend, 100)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/classifier.test.ts`
Expected: Failures — `classifyWithModel` not found.

- [ ] **Step 3: Implement classifier.ts**

```typescript
import type { TierName } from "./types"
import { TIER_NAMES } from "./types"

export const CLASSIFIER_SYSTEM_PROMPT = `You are a task complexity classifier for an AI coding assistant subagent.
Given a developer's task description, classify it into exactly one tier:
tier-1: trivial (grep, lookup, simple question, read-only)
tier-2: standard (single-file edit, write test, moderate reasoning)
tier-3: heavy (multi-file changes, debugging, feature implementation)
tier-4: critical (architecture, system design, complex debugging)
Return ONLY the tier name, nothing else.`

export type ClassifierSendFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>

const VALID_TIERS = new Set<string>(TIER_NAMES)

function parseTierResponse(response: string): TierName | null {
  const trimmed = response.trim().toLowerCase()
  if (VALID_TIERS.has(trimmed)) {
    return trimmed as TierName
  }
  // Try to extract tier-N from a longer response
  const match = trimmed.match(/tier-[1-4]/)
  if (match && VALID_TIERS.has(match[0])) {
    return match[0] as TierName
  }
  return null
}

export async function classifyWithModel(
  prompt: string,
  send: ClassifierSendFn,
  timeoutMs: number = 3000,
): Promise<TierName | null> {
  try {
    const response = await Promise.race([
      send(CLASSIFIER_SYSTEM_PROMPT, prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("classifier timeout")), timeoutMs)
      ),
    ])
    return parseTierResponse(response)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/classifier.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/classifier.ts tests/classifier.test.ts
git commit -m "feat: add small-model classifier with timeout and parse safety"
```

---

## Task 6: Interceptor

**Files:**
- Create: `src/interceptor.ts`
- Create: `tests/interceptor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest"
import { createInterceptor } from "../src/interceptor"
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
  intercept_tools: ["agent", "subtask", "delegate_task"],
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

  it("handles missing prompt in args gracefully", async () => {
    const interceptor = createInterceptor(baseConfig, baseTierMap, null)
    const output = { args: { agent: "explore" } }
    await interceptor({ tool: "agent", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.model).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/interceptor.test.ts`
Expected: Failures — `createInterceptor` not found.

- [ ] **Step 3: Implement interceptor.ts**

```typescript
import type { TierName, TierMap, WorkloadRouterConfig, ResolvedModel } from "./types"
import { classifyHeuristic } from "./heuristic"
import type { ClassifierSendFn } from "./classifier"
import { classifyWithModel } from "./classifier"

type ToolInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolOutput = {
  args: any
}

type ClassifyFn = (prompt: string) => Promise<TierName | null>

function extractPrompt(args: Record<string, unknown>): string | null {
  // Try common field names for the task prompt
  for (const key of ["prompt", "description", "content", "text", "message"]) {
    const val = args[key]
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}

function extractAgentName(args: Record<string, unknown>): string | null {
  const val = args.agent ?? args.agentName ?? args.name
  return typeof val === "string" ? val : null
}

export function createInterceptor(
  config: WorkloadRouterConfig,
  tierMap: TierMap,
  classifierSend: ClassifierSendFn | null,
) {
  const interceptTools = new Set(config.intercept_tools.map(t => t.toLowerCase()))
  const excludeAgents = new Set(config.exclude_agents)

  async function classifyPrompt(prompt: string): Promise<TierName> {
    // 1. Heuristic pass (also handles tier tags)
    const heuristic = classifyHeuristic(prompt)
    if (heuristic.confidence === "high") {
      return heuristic.tier
    }

    // 2. Small-model classifier
    if (classifierSend) {
      const tier = await classifyWithModel(prompt, classifierSend)
      if (tier) return tier
    }

    // 3. Default fallback
    return "tier-3"
  }

  return async function intercept(input: ToolInput, output: ToolOutput): Promise<void> {
    const toolName = String(input?.tool ?? "").toLowerCase()
    if (!interceptTools.has(toolName)) return

    const args = output?.args
    if (!args || typeof args !== "object") return

    const prompt = extractPrompt(args as Record<string, unknown>)
    if (!prompt) return

    const agent = extractAgentName(args as Record<string, unknown>)
    if (agent && excludeAgents.has(agent)) return

    const tier = await classifyPrompt(prompt)
    const resolved = tierMap[tier]
    if (!resolved) return

    const modelValue: Record<string, string> = {
      providerID: resolved.providerID,
      modelID: resolved.modelID,
    }
    if (resolved.variant) {
      modelValue.variant = resolved.variant
    }

    ;(args as Record<string, unknown>).model = modelValue
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/interceptor.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/interceptor.ts tests/interceptor.test.ts
git commit -m "feat: add spawn interceptor with classification chain"
```

---

## Task 7: System Prompt Injection

**Files:**
- Create: `src/system-prompt.ts`
- Create: `tests/system-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest"
import { createSystemPromptHook, TIER_INSTRUCTION_TEXT } from "../src/system-prompt"

describe("createSystemPromptHook", () => {
  it("appends tier instructions to system prompt array", async () => {
    const hook = createSystemPromptHook()
    const output = { system: ["You are a helpful assistant."] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(2)
    expect(output.system[1]).toBe(TIER_INSTRUCTION_TEXT)
  })

  it("works with empty system array", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [] as string[] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toBe(TIER_INSTRUCTION_TEXT)
  })

  it("does not duplicate if already present", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [TIER_INSTRUCTION_TEXT] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/system-prompt.test.ts`
Expected: Failures — `createSystemPromptHook` not found.

- [ ] **Step 3: Implement system-prompt.ts**

```typescript
import type { Model } from "@opencode-ai/sdk"

export const TIER_INSTRUCTION_TEXT = `When delegating tasks to subagents, assess the complexity and prefix your delegation prompt with a tier tag:

  [tier-1] — Trivial: file lookup, grep, simple question, read-only
  [tier-2] — Standard: single-file edit, write a test, moderate reasoning
  [tier-3] — Heavy: multi-file refactor, debugging, feature implementation
  [tier-4] — Critical: architecture, system design, complex debugging

Example: "[tier-1] Find all files importing the auth module"

If you omit the tag, the system will classify automatically.`

type SystemTransformInput = {
  sessionID?: string
  model: Model
}

type SystemTransformOutput = {
  system: string[]
}

export function createSystemPromptHook() {
  return async function hook(
    _input: SystemTransformInput,
    output: SystemTransformOutput,
  ): Promise<void> {
    if (output.system.includes(TIER_INSTRUCTION_TEXT)) return
    output.system.push(TIER_INSTRUCTION_TEXT)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/system-prompt.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt.test.ts
git commit -m "feat: add system prompt injection for tier instructions"
```

---

## Task 8: Plugin Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement the plugin entry that wires everything together**

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { resolveTiers } from "./tier-resolver"
import { createInterceptor } from "./interceptor"
import { createSystemPromptHook } from "./system-prompt"
import type { ClassifierSendFn } from "./classifier"

export const WorkloadRouter: Plugin = async ({ client }) => {
  const config = loadConfig()

  if (!config.enabled) {
    console.log("[workload-router] Disabled in config")
    return {}
  }

  // Query connected providers
  let providers: any[] = []
  let connectedIds: string[] = []
  try {
    const providerResponse = await client.provider.list()
    if (providerResponse.data) {
      providers = providerResponse.data.all ?? []
      connectedIds = providerResponse.data.connected ?? []
    }
  } catch (err) {
    console.warn("[workload-router] Failed to query providers:", err)
    return {}
  }

  if (connectedIds.length === 0) {
    console.warn("[workload-router] No connected providers found, disabling")
    return {}
  }

  // Resolve tier → model mapping
  const tierMap = resolveTiers(
    providers,
    connectedIds,
    config.provider_priority,
    config.tier_overrides,
  )

  const filledTiers = Object.entries(tierMap).filter(([, v]) => v != null)
  if (filledTiers.length === 0) {
    console.warn("[workload-router] No tiers could be resolved, disabling")
    return {}
  }

  console.log("[workload-router] Resolved tiers:")
  for (const [tier, model] of filledTiers) {
    const variant = model!.variant ? ` (variant: ${model!.variant})` : ""
    console.log(`  ${tier}: ${model!.providerID}/${model!.modelID}${variant}`)
  }

  // Build classifier send function if a classifier model is available
  let classifierSend: ClassifierSendFn | null = null
  if (config.classifier_model || tierMap["tier-1"]) {
    const classifierModelId = config.classifier_model
      ?? `${tierMap["tier-1"]!.providerID}/${tierMap["tier-1"]!.modelID}`

    classifierSend = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const [providerID, ...modelParts] = classifierModelId.split("/")
      const modelID = modelParts.join("/")

      const session = await client.session.create()
      if (!session.data) throw new Error("Failed to create classifier session")

      const response = await client.session.prompt({
        path: { id: session.data.id },
        body: {
          model: { providerID, modelID },
          system: systemPrompt,
          parts: [{ type: "text", text: userPrompt }],
          noReply: false,
        },
      })

      // Extract text from response
      if (response.data?.parts) {
        for (const part of response.data.parts) {
          if ("text" in part && typeof part.text === "string") {
            return part.text
          }
        }
      }
      return ""
    }
  }

  const interceptor = createInterceptor(config, tierMap, classifierSend)
  const systemPromptHook = createSystemPromptHook()

  return {
    "experimental.chat.system.transform": systemPromptHook,
    "tool.execute.before": interceptor,
  }
}

export default WorkloadRouter
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Zero TypeScript errors.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire plugin entry point with all hooks"
```

---

## Task 9: Init CLI

**Files:**
- Create: `bin/init.ts`

- [ ] **Step 1: Install @clack/prompts**

Run: `npm install @clack/prompts`

- [ ] **Step 2: Implement the init CLI**

```typescript
#!/usr/bin/env node

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { intro, outro, multiselect, text, confirm, isCancel, cancel } from "@clack/prompts"

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg || path.join(os.homedir(), ".config")
}

async function main() {
  intro("opencode-workload-router setup")

  const providerChoices = [
    { value: "anthropic", label: "Anthropic" },
    { value: "openai", label: "OpenAI (GPT)" },
    { value: "google", label: "Google (Gemini)" },
    { value: "xai", label: "xAI (Grok)" },
    { value: "github-copilot", label: "GitHub Copilot" },
    { value: "opencode", label: "OpenCode" },
  ]

  const selected = await multiselect({
    message: "Which providers should be prioritized? (select in priority order)",
    options: providerChoices,
    required: true,
  })

  if (isCancel(selected)) {
    cancel("Setup cancelled")
    process.exit(0)
  }

  const classifierModel = await text({
    message: "Classifier model (leave empty for auto-detect from cheapest tier-1)",
    placeholder: "e.g. openai/gpt-5-nano",
    defaultValue: "",
  })

  if (isCancel(classifierModel)) {
    cancel("Setup cancelled")
    process.exit(0)
  }

  const excludeInput = await text({
    message: "Agents to exclude from routing (comma-separated, or empty)",
    placeholder: "e.g. sisyphus, prometheus",
    defaultValue: "",
  })

  if (isCancel(excludeInput)) {
    cancel("Setup cancelled")
    process.exit(0)
  }

  const excludeAgents = typeof excludeInput === "string" && excludeInput.length > 0
    ? excludeInput.split(",").map(s => s.trim()).filter(Boolean)
    : []

  const config: Record<string, unknown> = {
    enabled: true,
    provider_priority: selected,
    exclude_agents: excludeAgents,
    intercept_tools: ["agent", "subtask", "delegate_task", "call_omo_agent"],
  }

  if (typeof classifierModel === "string" && classifierModel.length > 0) {
    config.classifier_model = classifierModel
  }

  const configDir = path.join(getConfigDir(), "opencode")
  const configPath = path.join(configDir, "workload-router.json")

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

  outro(`Config written to ${configPath}\n\nAdd "opencode-workload-router" to your opencode.json plugin array.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add bin/init.ts
git commit -m "feat: add init CLI for interactive setup"
```

---

## Task 10: Build, Package, and README

**Files:**
- Create: `README.md`
- Modify: `package.json` (add @clack/prompts to dependencies)

- [ ] **Step 1: Write README**

```markdown
# opencode-workload-router

OpenCode plugin that auto-routes subagents to tiered models based on workload classification.

## How It Works

The plugin intercepts subagent spawn calls and rewrites the model based on task complexity:

1. **Main agent tags** — If the main agent prefixes the task with `[tier-1]` through `[tier-4]`, that tier is used directly
2. **Heuristic** — Keyword/token analysis classifies obvious cases at zero cost
3. **Small-model classifier** — Ambiguous prompts are classified by a cheap model (~100 tokens)

Models for each tier are auto-detected from your connected providers, ranked by your configured priority.

## The 4 Tiers

| Tier | When | Model Class |
|---|---|---|
| tier-1 | Trivial: grep, lookup, simple question | nano/flash |
| tier-2 | Standard: single-file edit, write a test | mid-range (Sonnet, GPT-5.2) |
| tier-3 | Heavy: multi-file refactor, debugging | premium (GPT-5.4, Opus) |
| tier-4 | Critical: architecture, system design | frontier max reasoning |

## Install

```bash
npm install opencode-workload-router
npx opencode-workload-router init
```

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-workload-router"]
}
```

## Config

Config file: `~/.config/opencode/workload-router.json`

```jsonc
{
  "enabled": true,
  "provider_priority": ["anthropic", "openai", "google"],
  "classifier_model": "openai/gpt-5-nano",    // optional
  "exclude_agents": ["sisyphus", "prometheus"], // keep on their static model
  "tier_overrides": {                           // optional manual overrides
    "tier-4": { "model": "openai/gpt-5.4", "variant": "xhigh" }
  },
  "intercept_tools": ["agent", "subtask", "delegate_task", "call_omo_agent"]
}
```

## Compatibility

- Works standalone with vanilla OpenCode
- Works alongside oh-my-opencode
- Does not touch the main agent's model
- Backward compatible — disabled by default

## License

MIT
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: `dist/` directory created with compiled JS and declaration files.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: Zero errors.

- [ ] **Step 5: Test package with npm pack**

Run: `npm pack --dry-run`
Expected: Tarball contents listed, no missing files.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and config guide"
```

---

## Completion Criteria

- [ ] All 6 source files compile without errors
- [ ] All tests pass (config, heuristic, classifier, tier-resolver, interceptor, system-prompt)
- [ ] Plugin loads in OpenCode without errors when disabled (default state)
- [ ] `npx opencode-workload-router init` produces a valid config file
- [ ] `npm pack` succeeds without missing files
- [ ] README documents install, config, tiers, and compatibility
