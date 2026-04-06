# Dynamic Workload Router — Design Spec

## Summary

A standalone OpenCode plugin (`opencode-workload-router`) that intercepts subagent spawn calls and rewrites the model based on task complexity. The main agent is the primary decision-maker for tier classification, with heuristic and small-model classifiers as fallbacks.

The plugin auto-detects the best available model per tier from connected providers, ranked by user-configured provider priority set during install.

Works with or without oh-my-opencode. Does not touch the main agent's model.

## Problem

OpenCode assigns one model per agent route. Subagents all run on the same model regardless of whether the task is "grep for a string" or "refactor the auth system." This wastes money on trivial tasks and can under-serve critical ones.

There is no built-in mechanism for the main agent to choose the right model for each subagent at spawn time based on workload.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Classification strategy | Hybrid: main agent judgment + heuristic + small-model | Main agent has full context; heuristic is zero-cost; small-model catches ambiguous cases |
| Tier count | 4 direct model tiers | Covers the full spectrum without over-complicating |
| Category mapping | None — tiers map directly to models | Avoids indirection; standalone from OmO categories |
| Profile presets | None | Classification handles routing dynamically |
| Model selection | Auto-detect from connected providers | Works out of the box; user sets provider priority |
| Scope | Subagent spawns only | Main agent stays on user-configured model |
| Hook mechanism | `tool.execute.before` (spawn interception) | Transparent to the main agent; no new tools required |
| Main agent communication | System prompt injection via `experimental.chat.system.transform` | Main agent learns to tag delegations with tier hints |

## Architecture

### Plugin Entry

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const WorkloadRouter: Plugin = async ({ client }) => {
  const config = loadPluginConfig()
  if (!config.enabled) return {}

  const tierMap = await resolveTiers(client, config.provider_priority, config.tier_overrides)

  return {
    "experimental.chat.system.transform": async (input, output) => {
      // Inject tier system instructions into main agent's system prompt
    },
    "tool.execute.before": async (input, output) => {
      // Intercept subagent spawns, classify, rewrite model
    },
  }
}
```

### Classification Priority Chain

```
Subagent spawn intercepted (tool.execute.before)
    |
    v
1. Is auto_routing enabled?
    |-- no --> pass through unchanged
    |-- yes
         |
         v
2. Is this agent in exclude_agents?
    |-- yes --> pass through unchanged
    |-- no
         |
         v
3. Did the main agent specify a tier tag in the prompt?
   (e.g., "[tier-2] grep for all TODO comments")
    |-- yes --> use specified tier
    |-- no
         |
         v
4. Heuristic pass (zero cost, instant)
    |-- confident match --> use that tier
    |-- ambiguous
         |
         v
5. Small-model classifier (~100 tokens, <3s)
    |-- valid tier --> use it
    |-- invalid/timeout --> tier-3 (safe default)
    |
    v
6. Look up tier --> model from tierMap
    |
    v
7. Rewrite output.args with resolved model
    |
    v
Subagent launches with routed model
```

### System Prompt Injection

The plugin uses `experimental.chat.system.transform` to append instructions to the main agent's system prompt:

```
When delegating tasks to subagents, assess the complexity and prefix
your delegation prompt with a tier tag:

  [tier-1] — Trivial: file lookup, grep, simple question, read-only
  [tier-2] — Standard: single-file edit, write a test, moderate reasoning
  [tier-3] — Heavy: multi-file refactor, debugging, feature implementation
  [tier-4] — Critical: architecture, system design, complex debugging

Example: "[tier-1] Find all files importing the auth module"

If you omit the tag, the system will classify automatically.
```

This makes the main agent the primary classifier — it has the full conversation context and best understands the work.

## The 4 Tiers

| Tier | When | Capability Bracket | Model Class Example |
|---|---|---|---|
| tier-1 | Trivial — grep, file lookup, simple question, read-only | tool_call support | gpt-5-nano, qwen2.5-coder, minimax-flash |
| tier-2 | Standard — single-file edit, write a test, moderate reasoning | tool_call + reasoning | qwen3-coder, gpt-5.2, gemini-flash |
| tier-3 | Heavy — multi-file refactor, debugging, feature implementation | tool_call + reasoning + context >= 100K | gpt-5.4 medium, deepseek-r1, gemini-pro |
| tier-4 | Critical — architecture, complex system design | tool_call + reasoning + context >= 200K + highest variant | gpt-5.4 xhigh, deepseek-r1, glm-4.5 |

## Tier Auto-Detection

At plugin load:

1. Read `provider_priority` from config (set during install).
2. Query connected providers via the OpenCode client SDK.
3. For each tier, walk providers in priority order. Find the first provider that has a model matching the tier's capability bracket.
4. Store `tier -> { providerID, modelID, variant }` map in plugin memory.
5. Log resolved tiers at startup.
6. If `tier_overrides` are set in config, those take precedence over auto-detection for the specified tiers.

### Capability Bracket Matching

For each candidate model from a provider, check:

- **tier-1**: `model.capabilities.toolcall === true`
- **tier-2**: `model.capabilities.toolcall === true && model.capabilities.reasoning === true`
- **tier-3**: `model.capabilities.toolcall === true && model.capabilities.reasoning === true && model.limit.context >= 100000`
- **tier-4**: `model.capabilities.toolcall === true && model.capabilities.reasoning === true && model.limit.context >= 200000`

For tier-4, also select the highest available variant (e.g., `max`, `xhigh`).

Within a tier's capability bracket, prefer models with lower cost (if cost data is available from the provider), otherwise prefer the first match in provider priority order.

### Fallback When Tiers Can't Be Filled

If no connected provider has a model for a given tier, fall back to the next tier up that has a model. If no tiers can be filled, the plugin disables itself and logs a warning.

## Heuristic Classifier

Zero cost, runs synchronously before the small-model classifier.

### Rules

| Condition | Result |
|---|---|
| Prompt < 50 tokens AND no code blocks AND no complex keywords | tier-1 |
| Contains only read/search verbs: grep, find, read, list, search, look, check, "what is", explain | tier-1 |
| Single-file scope + action verbs: edit, fix, rename, add, remove, update, test | tier-2 |
| Multi-file indicators: "across", "all files", "project-wide", "refactor" + debug/implement keywords | tier-3 |
| Architecture keywords: architect, design, system, infrastructure, migration, "from scratch" | tier-4 |
| Prompt > 500 tokens with code blocks and design language | tier-4 |
| None of the above | ambiguous -> pass to small-model classifier |

### Keywords (initial set, tunable)

```typescript
const TIER_1_VERBS = ["grep", "find", "read", "list", "search", "look", "check", "what is", "explain", "show", "print", "count"]
const TIER_2_VERBS = ["edit", "fix", "rename", "add", "remove", "update", "test", "write test", "change", "replace", "move"]
const TIER_3_KEYWORDS = ["refactor", "debug", "implement", "feature", "integrate", "migrate", "across", "all files", "project-wide", "multiple"]
const TIER_4_KEYWORDS = ["architect", "design", "system", "infrastructure", "migration", "from scratch", "distributed", "scalable", "security audit", "performance"]
```

### Confidence

The heuristic returns `{ tier, confidence: "high" | "low" }`. Only `high` confidence results are used directly; `low` confidence falls through to the small-model classifier.

## Small-Model Classifier

Invoked only for ambiguous prompts (heuristic returned `low` confidence).

### Classifier Model

Uses `config.classifier_model` if set. Falls back to OpenCode's `small_model` config. Falls back to the resolved tier-1 model (cheapest available).

### System Prompt (~80 tokens)

```
You are a task complexity classifier for an AI coding assistant subagent.
Given a developer's task description, classify it into exactly one tier:
tier-1: trivial (grep, lookup, simple question, read-only)
tier-2: standard (single-file edit, write test, moderate reasoning)
tier-3: heavy (multi-file changes, debugging, feature implementation)
tier-4: critical (architecture, system design, complex debugging)
Return ONLY the tier name, nothing else.
```

### Behavior

- Input: the subagent task prompt
- Expected output: one of `tier-1`, `tier-2`, `tier-3`, `tier-4`
- Timeout: 3 seconds
- Invalid output: fall back to tier-3
- Classifier unavailable: heuristic-only mode (no error, just degraded)

## Spawn Interception

### Hook: `tool.execute.before`

```typescript
"tool.execute.before": async (input, output) => {
  const tool = String(input?.tool ?? "").toLowerCase()

  // Only intercept subagent-spawning tools
  if (!isSubagentTool(tool)) return

  const args = output?.args
  if (!args || typeof args !== "object") return

  // Extract task prompt from args
  const prompt = extractPrompt(args)
  if (!prompt) return

  // Check exclusions
  const agent = extractAgentName(args)
  if (config.exclude_agents.includes(agent)) return

  // Classify
  const tier = await classify(prompt, config, tierMap)

  // Rewrite model in args
  const resolved = tierMap[tier]
  if (resolved) {
    rewriteModel(args, resolved)
  }
}
```

### Identifying Subagent Tools

The plugin needs to detect which tool calls represent subagent spawns. Known patterns:
- Tool name contains "agent", "subtask", "delegate", "task"
- OmO-specific: `delegate_task`, `call_omo_agent`
- OpenCode built-in: agent spawn via `AgentPartInput`

The plugin maintains a configurable list of tool names to intercept.

### Rewriting Model

The plugin modifies `output.args` to set the model for the subagent. The exact field depends on how the spawning tool passes model configuration. The plugin attempts to set:
- `args.model` (if the tool accepts a model parameter)
- `args.providerID` and `args.modelID` (if using provider/model split)

If the tool args structure doesn't support model override, the plugin logs a warning and passes through unchanged.

## Config

### Plugin Config File

Location: `~/.config/opencode/workload-router.json`

```jsonc
{
  "enabled": true,
  "provider_priority": ["anthropic", "openai", "google"],
  "classifier_model": "openai/gpt-5-nano",
  "exclude_agents": ["sisyphus", "prometheus"],
  "tier_overrides": {
    "tier-1": { "model": "openai/gpt-5-nano" },
    "tier-4": { "model": "openai/gpt-5.4", "variant": "xhigh" }
  },
  "intercept_tools": ["agent", "subtask", "delegate_task", "call_omo_agent"]
}
```

### OpenCode Plugin Registration

```jsonc
// opencode.json
{
  "plugin": ["opencode-workload-router"]
}
```

### Config Schema

```typescript
const WorkloadRouterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider_priority: z.array(z.string()),
  classifier_model: z.string().optional(),
  exclude_agents: z.array(z.string()).default([]),
  tier_overrides: z.record(
    z.enum(["tier-1", "tier-2", "tier-3", "tier-4"]),
    z.object({
      model: z.string(),
      variant: z.string().optional(),
    })
  ).optional(),
  intercept_tools: z.array(z.string()).default(
    ["agent", "subtask", "delegate_task", "call_omo_agent"]
  ),
})
```

## Install CLI

```
npx opencode-workload-router init

? Which providers should be prioritized? (drag to reorder)
  1. anthropic
  2. openai
  3. google

? Classifier model (auto-detect cheapest, or specify):
  > auto

? Agents to exclude from routing:
  > sisyphus, prometheus

Writing config to ~/.config/opencode/workload-router.json
Add "opencode-workload-router" to your opencode.json plugin array

Done. Resolved tiers:
  tier-1: openai/gpt-5-nano
  tier-2: qwen/qwen3-coder
  tier-3: deepseek/deepseek-r1
  tier-4: openai/gpt-5.4 (variant: xhigh)
```

## Package Structure

```
opencode-workload-router/
  src/
    index.ts              # Plugin entry, exports WorkloadRouter
    config.ts             # Load/validate workload-router.json
    tier-resolver.ts      # Auto-detect models per tier from connected providers
    heuristic.ts          # Keyword/token heuristic classifier
    classifier.ts         # Small-model LLM classifier
    interceptor.ts        # tool.execute.before hook logic
    system-prompt.ts      # experimental.chat.system.transform hook
  bin/
    init.ts               # npx init CLI (provider priority prompt)
  tests/
    heuristic.test.ts
    classifier.test.ts
    tier-resolver.test.ts
    interceptor.test.ts
  package.json
  tsconfig.json
  README.md
```

## Error Handling

| Failure | Behavior |
|---|---|
| Plugin config missing or invalid | Plugin disabled, pass-through, log warning |
| No connected providers for a tier | Fall back to next tier up that has a model |
| No tiers can be filled at all | Plugin disables itself, logs warning |
| Classifier model not available | Heuristic-only mode (degraded, not broken) |
| Classifier returns invalid tier | Fall back to tier-3 |
| Classifier times out (>3s) | Fall back to tier-3 |
| Tool args don't support model rewrite | Pass through unchanged, log warning |
| Non-subagent tool intercepted | Ignore, pass through |

## Compatibility

- Works standalone with vanilla OpenCode
- Works alongside oh-my-opencode (OmO agent/category routing still applies; this plugin overrides the model for intercepted subagent calls)
- If OmO is present and sets a model for a subagent via category routing, this plugin's rewrite takes precedence (it runs in `tool.execute.before` after OmO's config mutations)
- `ultrawork` keyword in the main thread is not affected (it applies to the main agent, not subagents)

## What This Does NOT Do

- Does not touch the main agent's model
- Does not do mid-call model fallback (out of scope; see opencode-fallback plugin)
- Does not maintain a pricing database
- Does not replace oh-my-opencode or compete with it
- Does not classify the main thread's prompts
- Does not require any specific plugin or provider

## Future Extensions (Out of Scope for v1)

- Cooldown-based tier demotion when a model gets rate-limited
- Telemetry: track how often each tier is used, cost savings estimate
- User-tunable heuristic keywords via config
- Per-project tier overrides
