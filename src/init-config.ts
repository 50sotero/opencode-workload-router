import { DEFAULT_INTERCEPT_TOOLS } from "./config.js"
import { TIER_NAMES } from "./types.js"
import type { TierName, WorkloadRouterConfig } from "./types.js"

export type RoutingMode = "single-provider" | "multi-provider" | "manual-tier-models"

type TierOverrideInput = { model: string; variant?: string }

export type InitConfigAnswers = {
  routingMode: RoutingMode
  singleProvider?: string
  providerPriority?: string[]
  tierOverrides?: Partial<Record<TierName, TierOverrideInput>>
  classifierModel?: string
  excludeAgents: string[]
}

function uniqueProvidersFromOverrides(
  tierOverrides: Partial<Record<TierName, TierOverrideInput>>,
): string[] {
  const seen = new Set<string>()
  const providerIds: string[] = []

  for (const tier of TIER_NAMES) {
    const modelRef = tierOverrides[tier]?.model
    if (!modelRef) continue

    const providerID = modelRef.split("/")[0]
    if (!providerID || seen.has(providerID)) continue

    seen.add(providerID)
    providerIds.push(providerID)
  }

  return providerIds
}

export function validateModelRef(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return "Model reference is required"

  const slashIndex = trimmed.indexOf("/")
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return "Enter the model as provider/model"
  }

  return undefined
}

export function buildInitConfig(answers: InitConfigAnswers): WorkloadRouterConfig {
  let providerPriority: string[] = []

  switch (answers.routingMode) {
    case "single-provider":
      providerPriority = answers.singleProvider ? [answers.singleProvider] : []
      break
    case "multi-provider":
      providerPriority = answers.providerPriority ?? []
      break
    case "manual-tier-models":
      providerPriority = uniqueProvidersFromOverrides(answers.tierOverrides ?? {})
      break
  }

  return {
    enabled: true,
    provider_priority: providerPriority,
    classifier_model: answers.classifierModel?.trim() ? answers.classifierModel.trim() : undefined,
    exclude_agents: answers.excludeAgents,
    tier_overrides: answers.tierOverrides && Object.keys(answers.tierOverrides).length > 0
      ? answers.tierOverrides
      : undefined,
    intercept_tools: DEFAULT_INTERCEPT_TOOLS,
  }
}
