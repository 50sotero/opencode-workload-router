// Resolves connected provider models into a 4-tier capability map.
// Tiers: tier-1 (toolcall), tier-2 (+reasoning), tier-3 (+100K ctx), tier-4 (+200K ctx).
// Respects provider priority order, tier_overrides, and falls back missing tiers upward.

import { TIER_NAMES } from "./types.js"
import type { TierName, TierMap, ResolvedModel, WorkloadRouterConfig } from "./types.js"

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
    // Prefer non-reasoning (cheapest/least capable) first
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
  const allModels: Array<{ providerID: string; model: ProviderModel }> = []

  for (const providerId of providerPriority) {
    if (!connectedSet.has(providerId)) continue
    const provider = providers.find(p => p.id === providerId)
    if (!provider) continue

    for (const model of Object.values(provider.models)) {
      allModels.push({ providerID: providerId, model })
    }
  }

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
