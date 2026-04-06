#!/usr/bin/env node

// Interactive setup CLI for opencode-workload-router.
// Writes config to ~/.config/opencode/workload-router.json (respects XDG_CONFIG_HOME).

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { intro, outro, multiselect, text, isCancel, cancel } from "@clack/prompts"

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

  const excludeAgents =
    typeof excludeInput === "string" && excludeInput.length > 0
      ? excludeInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
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

  outro(
    `Config written to ${configPath}\n\nAdd "opencode-workload-router" to your opencode.json plugin array.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
