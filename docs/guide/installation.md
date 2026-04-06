# Installation

## For Humans

Paste this into your coding agent session (AmpCode, Cursor, etc.):

```
Install and configure opencode-workload-router by following the instructions here:
https://raw.githubusercontent.com/50sotero/opencode-workload-router/refs/heads/master/docs/guide/installation.md
```

Or do it manually — but letting an agent handle it is faster and less error-prone.

## For LLM Agents

> **IMPORTANT: Use `curl` to fetch this file, NOT WebFetch.** WebFetch summarizes content and loses critical details. Always use:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/50sotero/opencode-workload-router/refs/heads/master/docs/guide/installation.md
> ```

If you're an LLM Agent helping set up opencode-workload-router, follow these steps.

### Step 0: Ask user about their setup

Ask the user these questions to configure the plugin:

1. **Which providers do you have connected in OpenCode?**
   Common options: `anthropic`, `openai`, `google`, `xai`, `github-copilot`, `opencode`
   This determines `provider_priority` — order them by preference (best models first).

2. **Are there any agents you want to exclude from routing?**
   Some agents (like Sisyphus, Prometheus) may need to stay on their statically-configured model.
   These go into `exclude_agents`.

3. **Do you want to specify a classifier model, or auto-detect?**
   - **Auto-detect** (recommended): the plugin uses the cheapest tier-1 model as the classifier
   - **Specify**: provide a model ID like `openai/gpt-5-nano` or `google/gemini-2.5-flash`

### Step 1: Verify OpenCode is installed

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first: https://opencode.ai/docs"
fi
```

### Step 2: Install the plugin

```bash
cd ~/.config/opencode  # or wherever your opencode config lives
npm install opencode-workload-router
```

Verify installation:

```bash
ls node_modules/opencode-workload-router/dist/index.js && echo "Plugin installed successfully"
```

### Step 3: Register the plugin in opencode.json

Read the current opencode.json and add `opencode-workload-router` to the `plugin` array:

```bash
cat ~/.config/opencode/opencode.json
```

Add `"opencode-workload-router"` to the `plugin` array. Example result:

```json
{
  "plugin": ["oh-my-opencode@latest", "opencode-workload-router"]
}
```

If there's no `plugin` array, create one:

```json
{
  "plugin": ["opencode-workload-router"]
}
```

### Step 4: Create the config file

Based on the user's answers from Step 0, write the config file.

**Option A: Use the interactive CLI**

```bash
npx opencode-workload-router init
```

This will prompt for provider priority, classifier model, and excluded agents.

**Option B: Write the config directly** (faster for agents)

Create `~/.config/opencode/workload-router.json`:

```jsonc
{
  "enabled": true,
  "provider_priority": ["anthropic", "openai"],  // ordered by user preference
  "exclude_agents": [],                            // agents to skip routing for
  "intercept_tools": ["agent", "subtask", "delegate_task", "call_omo_agent"]
  // "classifier_model": "openai/gpt-5-nano"      // uncomment to override auto-detect
}
```

Adjust `provider_priority` and `exclude_agents` based on user's answers.

**Config field reference:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Must be `true` to activate routing |
| `provider_priority` | string[] | `[]` | Provider IDs in preference order |
| `classifier_model` | string? | auto-detect | Model for ambiguous prompt classification |
| `exclude_agents` | string[] | `[]` | Agent names that skip routing |
| `tier_overrides` | object? | none | Manual model override per tier |
| `intercept_tools` | string[] | see above | Tool names that trigger interception |

**Tier override example** (for users who want specific models on specific tiers):

```jsonc
{
  "tier_overrides": {
    "tier-1": { "model": "openai/gpt-5-nano" },
    "tier-4": { "model": "openai/gpt-5.4", "variant": "xhigh" }
  }
}
```

### Step 5: Verify setup

```bash
# Check config exists and is valid JSON
cat ~/.config/opencode/workload-router.json | python3 -m json.tool 2>/dev/null && echo "Config is valid JSON" || echo "Config has JSON errors"

# Check plugin is registered
cat ~/.config/opencode/opencode.json | grep -q "opencode-workload-router" && echo "Plugin registered in opencode.json" || echo "Plugin NOT found in opencode.json"

# Check plugin files exist
ls ~/.config/opencode/node_modules/opencode-workload-router/dist/index.js 2>/dev/null && echo "Plugin dist files present" || echo "Plugin dist files missing — run npm install"
```

### Step 6: Explain what happens next

Tell the user:

> **opencode-workload-router is installed and configured.**
>
> When you start a new OpenCode session, the plugin will:
> 1. Auto-detect the best model for each of the 4 tiers from your connected providers
> 2. Inject tier classification instructions into the main agent's system prompt
> 3. Intercept subagent spawns and route them to the appropriate model
>
> The main agent will learn to prefix delegations with `[tier-1]` through `[tier-4]`.
> If it doesn't tag a task, the heuristic and classifier handle it automatically.
>
> **The plugin is disabled by default.** It's now enabled in your config. To disable it later, set `"enabled": false` in `~/.config/opencode/workload-router.json`.

### Troubleshooting

**Plugin not loading:**
- Check `opencode.json` has `"opencode-workload-router"` in the `plugin` array
- Check `workload-router.json` has `"enabled": true`
- Restart OpenCode after changes

**No tiers resolved:**
- The plugin needs at least one connected provider with models that support tool calling
- Check that `provider_priority` lists providers you've actually authenticated with OpenCode
- Run `opencode auth login` if needed

**Classifier not working:**
- The classifier needs a cheap model available (tier-1 or configured `classifier_model`)
- If no classifier model is available, the plugin falls back to heuristic-only mode (still works, just less accurate on ambiguous prompts)

## How It Works

The plugin uses a 3-level classification chain:

1. **Main agent tier tags** — `[tier-1]` through `[tier-4]` prefix on delegation prompts
2. **Heuristic** — keyword/token analysis catches obvious cases at zero cost
3. **Small-model classifier** — cheap LLM call (~100 tokens) for ambiguous prompts

Models per tier are auto-detected from connected providers based on capability brackets:

| Tier | Capability Bracket | Example Models |
|------|--------------------|----------------|
| tier-1 | tool_call support | gpt-5-nano, gemini-2.5-flash |
| tier-2 | + reasoning | gpt-5.2, gemini-2.5-pro |
| tier-3 | + 100K context | gpt-5.4, gemini-2.5-pro |
| tier-4 | + 200K context, highest variant | gpt-5.4 xhigh, gemini-2.5-pro |

The plugin only routes **subagent** spawns. The main agent's model is never touched.
