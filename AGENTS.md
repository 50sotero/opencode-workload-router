# opencode-workload-router — OpenCode Plugin

**Version:** 0.1.0 | **License:** MIT

## OVERVIEW

OpenCode plugin (npm: `opencode-workload-router`) that intercepts subagent spawn calls and rewrites the model based on 4-tier workload classification. The main agent is the primary decision-maker for tier classification (via system prompt injection), with heuristic and small-model classifiers as fallbacks. Auto-detects the best available model per tier from connected providers. The init CLI auto-detects authenticated OpenCode providers from auth state and registers `opencode-workload-router@latest` in `opencode.json`. 11 TypeScript source files, ~550 LOC.

## STRUCTURE

```
opencode-workload-router/
├── src/
│   ├── index.ts              # Plugin entry: loadConfig → resolveTiers → createInterceptor → hooks
│   ├── config.ts             # JSONC config loader with Zod v4 validation
│   ├── types.ts              # Shared types: TierName, TierMap, ResolvedModel, WorkloadRouterConfig
│   ├── heuristic.ts          # Zero-cost keyword/token heuristic classifier
│   ├── classifier.ts         # Small-model LLM classifier with 3s timeout
│   ├── tier-resolver.ts      # Query providers, fill tier→model map by capability bracket
│   ├── interceptor.ts        # tool.execute.before: detect subagent spawn, classify, rewrite model
│   └── system-prompt.ts      # experimental.chat.system.transform: inject tier instructions
├── bin/
│   └── init.ts               # npx opencode-workload-router init (interactive setup CLI)
├── tests/
│   ├── config.test.ts        # 5 tests
│   ├── heuristic.test.ts     # 17 tests
│   ├── classifier.test.ts    # 6 tests
│   ├── tier-resolver.test.ts # 6 tests
│   ├── interceptor.test.ts   # 8 tests
│   └── system-prompt.test.ts # 3 tests
├── package.json
├── tsconfig.json
└── README.md
```

## INITIALIZATION FLOW

```
WorkloadRouter(ctx)
  ├─→ loadConfig()              # Read ~/.config/opencode/workload-router.json → Zod validate → defaults
  ├─→ client.provider.list()    # Query connected providers from OpenCode
  ├─→ resolveTiers()            # Auto-detect models per tier from providers by capability bracket
  ├─→ classifierSend?           # Build classifier send fn using tier-1 model (optional)
  ├─→ createInterceptor()       # Wire config + tierMap + classifier into tool.execute.before hook
  └─→ createSystemPromptHook()  # Inject tier tag instructions into main agent system prompt
```

## 2 OPENCODE HOOK HANDLERS

| Handler | Purpose |
|---------|---------|
| `experimental.chat.system.transform` | Injects tier classification instructions into main agent system prompt |
| `tool.execute.before` | Intercepts subagent spawns, classifies task, rewrites model in args |

## CLASSIFICATION PRIORITY CHAIN

```
Subagent spawn intercepted
  │
  ├─→ Tool in intercept_tools?  no → pass through
  ├─→ Agent in exclude_agents?  yes → pass through
  ├─→ Prompt has [tier-N] tag?  yes → use that tier (high confidence)
  ├─→ Heuristic keywords match? yes + high confidence → use tier
  ├─→ Small-model classifier    returns valid tier → use it
  └─→ Default fallback          → tier-3
  │
  └─→ Look up tier → model from tierMap → rewrite output.args.model
```

## THE 4 TIERS

| Tier | When | Capability Bracket |
|------|------|--------------------|
| tier-1 | Trivial: grep, lookup, simple question | tool_call only |
| tier-2 | Standard: single-file edit, write test | tool_call + reasoning |
| tier-3 | Heavy: multi-file refactor, debugging | tool_call + reasoning + 100K ctx |
| tier-4 | Critical: architecture, system design | tool_call + reasoning + 200K ctx |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Modify classification logic | `src/heuristic.ts` | Keyword arrays at top of file |
| Add new tier keywords | `src/heuristic.ts:8-34` | TIER_1_VERBS through TIER_4_KEYWORDS |
| Change capability brackets | `src/tier-resolver.ts:21-33` | `meetsBracket()` function |
| Modify config schema | `src/config.ts:12-26` | Zod ConfigSchema |
| Change system prompt text | `src/system-prompt.ts:1-10` | TIER_INSTRUCTION_TEXT constant |
| Modify spawn detection | `src/interceptor.ts:19-26` | `extractPrompt()` / `extractAgentName()` |
| Change classifier behavior | `src/classifier.ts` | System prompt, timeout, parsing |
| Plugin wiring | `src/index.ts` | All initialization logic |
| CLI setup | `bin/init.ts` | Interactive installer |

## CONFIG

```
~/.config/opencode/workload-router.json
```

Fields: `enabled` (bool), `provider_priority` (string[]), `classifier_model` (optional string), `exclude_agents` (string[]), `tier_overrides` (optional per-tier model/variant), `intercept_tools` (string[]).

Disabled by default. The init CLI (`npx opencode-workload-router init`) writes the config interactively, narrows provider choices to authenticated OpenCode providers when available, and auto-registers `opencode-workload-router@latest` in `opencode.json`.

## CONVENTIONS

- **Runtime**: Node.js / Bun compatible (ESM)
- **TypeScript**: strict mode, ES2022, bundler moduleResolution
- **Test framework**: Vitest
- **Factory pattern**: `createInterceptor()`, `createSystemPromptHook()` for hook constructors
- **File naming**: kebab-case for multi-word files
- **Module structure**: one responsibility per file, types in `types.ts`
- **Config format**: JSON, Zod v4 validation, snake_case keys
- **Error handling**: graceful degradation — invalid config/missing providers/classifier failure all fall back safely

## COMMANDS

```bash
npm test                            # Vitest test suite (45 tests)
npm run build                       # tsc → dist/
npm run typecheck                   # tsc --noEmit
npx opencode-workload-router init   # Interactive setup CLI
```

## COMPATIBILITY

- Works standalone with vanilla OpenCode
- Works alongside oh-my-opencode (OmO's category routing still applies; this plugin overrides model for intercepted subagent calls)
- Does not touch the main agent's model
- `ultrawork` keyword is unaffected (it applies to main agent, not subagents)
