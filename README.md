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

## Installation

### For Humans

Copy and paste this prompt to your LLM agent (Claude Code, AmpCode, Cursor, etc.):

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

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-workload-router"]
}
```

### For LLM Agents

Fetch the installation guide and follow it:

```bash
curl -fsSL https://raw.githubusercontent.com/50sotero/opencode-workload-router/refs/heads/master/docs/guide/installation.md
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
    "tier-4": { "model": "anthropic/claude-opus-4-6", "variant": "max" }
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
