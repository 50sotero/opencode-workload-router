#!/usr/bin/env node

// Interactive setup CLI for opencode-workload-router.
// Writes config to ~/.config/opencode/workload-router.json (respects XDG_CONFIG_HOME).

import { cancel, intro, isCancel, note, outro, select, text } from "@clack/prompts"
import { buildInitConfig, type RoutingMode, validateModelRef } from "../src/init-config.js"
import {
  buildProviderChoices,
  loadAuthenticatedProviderIds,
  persistInitFiles,
  type ProviderChoice,
  validateModelId,
} from "../src/init-opencode.js"
import type { TierName } from "../src/types.js"

const tierPromptDetails: Array<{ tier: TierName; description: string; placeholder: string }> = [
  {
    tier: "tier-1",
    description: "trivial tasks (cheapest tool-call model)",
    placeholder: "e.g. openai/gpt-5-nano",
  },
  {
    tier: "tier-2",
    description: "standard tasks (reasoning model)",
    placeholder: "e.g. google/gemini-2.5-flash",
  },
  {
    tier: "tier-3",
    description: "heavy tasks (strong reasoning + long context)",
    placeholder: "e.g. google/gemini-2.5-pro",
  },
  {
    tier: "tier-4",
    description: "critical tasks (highest capability)",
    placeholder: "e.g. openai/gpt-5.4",
  },
]

function unwrapCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled")
    process.exit(0)
  }

  return value
}

async function promptRoutingMode(): Promise<RoutingMode> {
  return unwrapCancelled(await select({
    message: "How should routing choose models?",
    options: [
      {
        value: "single-provider",
        label: "Use one provider for all tiers",
        hint: "auto-detect every tier from one provider",
      },
      {
        value: "multi-provider",
        label: "Auto-pick across multiple providers",
        hint: "rank providers and let the plugin choose per tier",
      },
      {
        value: "manual-tier-models",
        label: "Choose specific models across providers",
        hint: "pin tier-1 through tier-4 manually",
      },
    ],
    initialValue: "multi-provider",
  }))
}

async function promptSingleProvider(providerChoices: ProviderChoice[]): Promise<string> {
  return unwrapCancelled(await select({
    message: "Which provider should supply all tier models?",
    options: providerChoices.map(choice => ({ ...choice })),
  }))
}

async function promptProviderPriority(providerChoices: ProviderChoice[]): Promise<string[]> {
  const remaining = providerChoices.map(choice => ({ ...choice }))
  const selectedProviders: string[] = []

  while (remaining.length > 0) {
    const nextProvider = unwrapCancelled(await select({
      message: selectedProviders.length === 0
        ? "Select the highest-priority provider"
        : "Select the next provider (or finish)",
      options: [
        ...remaining,
        ...(selectedProviders.length > 0
          ? [{ value: "__done__", label: "Done selecting providers" }]
          : []),
      ],
    }))

    if (nextProvider === "__done__") {
      break
    }

    selectedProviders.push(nextProvider)
    const nextIndex = remaining.findIndex(option => option.value === nextProvider)
    if (nextIndex >= 0) {
      remaining.splice(nextIndex, 1)
    }
  }

  return selectedProviders
}

async function promptTierOverrides(providerChoices: ProviderChoice[]): Promise<Partial<Record<TierName, { model: string; variant?: string }>>> {
  const overrides: Partial<Record<TierName, { model: string; variant?: string }>> = {}

  for (const { tier, description, placeholder } of tierPromptDetails) {
    const provider = providerChoices.length === 1
      ? providerChoices[0].value
      : unwrapCancelled(await select({
          message: `Provider for ${tier} (${description})`,
          options: providerChoices.map(choice => ({ ...choice })),
        }))

    const modelId = unwrapCancelled(await text({
      message: `Model ID for ${tier} inside ${provider}`,
      placeholder: placeholder.split("/").slice(1).join("/"),
      validate: validateModelId,
    }))

    const variant = unwrapCancelled(await text({
      message: `Variant for ${tier} (optional)`,
      placeholder: "e.g. xhigh",
      defaultValue: "",
    }))

    overrides[tier] = {
      model: `${provider}/${modelId.trim()}`,
      ...(variant.trim() ? { variant: variant.trim() } : {}),
    }
  }

  return overrides
}

function parseExcludeAgents(input: string): string[] {
  return input.length > 0
    ? input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

async function main() {
  intro("opencode-workload-router setup")

  const authenticatedProviders = loadAuthenticatedProviderIds()
  const providerChoices = buildProviderChoices(authenticatedProviders)

  if (authenticatedProviders.length > 0) {
    note(
      `Detected authenticated OpenCode providers: ${authenticatedProviders.join(", ")}`,
      "Provider detection",
    )
  } else {
    note(
      "No authenticated OpenCode providers were detected. Falling back to the built-in provider catalog. Run `opencode auth login` if you want init to narrow the choices automatically.",
      "Provider detection",
    )
  }

  const routingMode = await promptRoutingMode()

  const singleProvider = routingMode === "single-provider"
    ? await promptSingleProvider(providerChoices)
    : undefined

  const providerPriority = routingMode === "multi-provider"
    ? await promptProviderPriority(providerChoices)
    : undefined

  const tierOverrides = routingMode === "manual-tier-models"
    ? await promptTierOverrides(providerChoices)
    : undefined

  const classifierModel = unwrapCancelled(await text({
    message: "Classifier model (leave empty for auto-detect from cheapest tier-1)",
    placeholder: "e.g. openai/gpt-5-nano",
    defaultValue: "",
    validate: value => value?.trim() ? validateModelRef(value) : undefined,
  }))

  const excludeInput = unwrapCancelled(await text({
    message: "Agents to exclude from routing (comma-separated, or empty)",
    placeholder: "e.g. sisyphus, prometheus",
    defaultValue: "",
  }))

  const config = buildInitConfig({
    routingMode,
    singleProvider,
    providerPriority,
    tierOverrides,
    classifierModel,
    excludeAgents: parseExcludeAgents(excludeInput),
  })

  const { workloadRouterConfigPath, opencodeConfigPath } = persistInitFiles(config)

  outro(
    `Config written to ${workloadRouterConfigPath}\nAuto-update plugin registration written to ${opencodeConfigPath}.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
