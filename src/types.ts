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
