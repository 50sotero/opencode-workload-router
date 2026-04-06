# opencode-workload-router

OpenCode plugin that auto-routes subagents to tiered models based on workload classification.

## How It Works

The plugin intercepts subagent spawn calls and rewrites the model based on task complexity:

0. **Session override** — If the user says something like `from now on, use gpt 5.3 codex for future subagent deployments`, future subagent spawns in that session use the resolved model directly until the user says `go back to workload routing`
1. **Main agent tags** — If the main agent prefixes the task with `[tier-1]` through `[tier-4]`, that tier is used directly
2. **Heuristic** — Keyword/token analysis classifies obvious cases at zero cost
3. **Small-model classifier** — Ambiguous prompts are classified by a cheap model (~100 tokens)

Models for each tier are auto-detected from your connected providers, ranked by your configured priority.

## The 4 Tiers

| Tier | When | Model Class |
|---|---|---|
| tier-1 | Trivial: grep, lookup, simple question | nano/flash (e.g. GPT-5 Nano, MiniCPM4-0.5B) |
| tier-2 | Standard: single-file edit, write a test | mid-range (e.g. GPT-5.2, Qwen3-8B) |
| tier-3 | Heavy: multi-file refactor, debugging | premium (e.g. GPT-5.4, DeepSeek-R1-Distill-Qwen-7B) |
| tier-4 | Critical: architecture, system design | frontier max reasoning (e.g. GPT-5.4 xhigh, QwQ-32B) |

This works well with both hosted models and OSS Chinese models, especially when you want lightweight, coder-focused, and reasoning-heavy tiers in the same routing setup.

## Installation

### For Humans

Copy and paste this prompt to your coding agent (AmpCode, Cursor, etc.):

```
Install and configure opencode-workload-router by following the instructions here:
https://raw.githubusercontent.com/50sotero/opencode-workload-router/refs/heads/master/docs/guide/installation.md
```

Or install manually:

```bash
cd ~/.config/opencode
npm install opencode-workload-router
npx opencode-workload-router init
```

The init CLI now:
- auto-detects the providers you already authenticated in OpenCode,
- lets you use one provider for all tiers,
- auto-pick across multiple providers in priority order,
- or pin tier-1 through tier-4 to specific models across those providers,
- and registers `opencode-workload-router@latest` in `opencode.json` so OpenCode keeps it updated on launch.

### For LLM Agents

Fetch the installation guide and follow it:

```bash
curl -fsSL https://raw.githubusercontent.com/50sotero/opencode-workload-router/refs/heads/master/docs/guide/installation.md
```

## Config

Config file: `~/.config/opencode/workload-router.json`

OpenCode plugin registration (managed automatically by `init`):

```json
{
  "plugin": ["opencode-workload-router@latest"]
}
```

```jsonc
{
  "enabled": true,
  "provider_priority": ["openai", "google"],
  "classifier_model": "openai/gpt-5-nano",    // optional
  "exclude_agents": ["sisyphus", "prometheus"], // keep on their static model
  "tier_overrides": {                           // optional per-tier model pins
    "tier-1": { "model": "openai/gpt-5-nano" },
    "tier-2": { "model": "google/gemini-2.5-flash" },
    "tier-3": { "model": "google/gemini-2.5-pro" },
    "tier-4": { "model": "openai/gpt-5.4", "variant": "xhigh" }
  },
  "intercept_tools": ["task", "agent", "subtask", "delegate_task", "call_omo_agent"]
}
```

If you choose the single-provider setup path in `init`, the CLI writes a one-item `provider_priority` array and leaves tier selection to auto-detection inside that provider. If no authenticated providers are detected, `init` falls back to the built-in provider catalog and tells you to run `opencode auth login` for a narrower list.

## Compatibility

- Works standalone with vanilla OpenCode
- Works alongside oh-my-opencode
- Does not touch the main agent's model
- Backward compatible — disabled by default

## License

MIT
