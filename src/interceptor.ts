// Interceptor — hooked into tool.execute.before. Detects subagent tool calls,
// classifies the task prompt through the 3-level chain (tier tag → heuristic →
// small-model classifier), and rewrites output.args.model before dispatch.
import type { ClassifierSendFn } from "./classifier.js"
import { classifyWithModel } from "./classifier.js"
import { classifyHeuristic } from "./heuristic.js"
import type { SessionModelOverrideStore } from "./session-overrides.js"
import type { TierName, TierMap, WorkloadRouterConfig, ResolvedModel } from "./types.js"

export type RoutingReason = "one-shot" | "persistent-override" | "tier-classification"

export type RoutingEvent = {
  model: ResolvedModel
  tier?: TierName
  reason: RoutingReason
  tool: string
  agent?: string
}

export type RoutingNotifyFn = (event: RoutingEvent) => void

type ToolInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolOutput = {
  args: unknown
}

function extractPrompt(args: Record<string, unknown>): string | null {
  // Try common field names for the task prompt
  for (const key of ["prompt", "description", "content", "text", "message"]) {
    const val = args[key]
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}

function extractAgentName(args: Record<string, unknown>): string | null {
  const val = args.agent ?? args.agentName ?? args.name ?? args.subagent_type
  return typeof val === "string" ? val : null
}

export function createInterceptor(
  config: WorkloadRouterConfig,
  tierMap: TierMap,
  classifierSend: ClassifierSendFn | null,
  sessionOverrides?: SessionModelOverrideStore,
  onRouted?: RoutingNotifyFn,
) {
  const interceptTools = new Set(config.intercept_tools.map(t => t.toLowerCase()))
  const excludeAgents = new Set(config.exclude_agents)

  async function classifyPrompt(prompt: string): Promise<TierName> {
    // 1. Heuristic pass (also handles explicit tier tags via high confidence)
    const heuristic = classifyHeuristic(prompt)
    if (heuristic.confidence === "high") {
      return heuristic.tier
    }

    // 2. Small-model classifier fallback
    if (classifierSend) {
      const tier = await classifyWithModel(prompt, classifierSend)
      if (tier) return tier
    }

    // 3. Default fallback
    return "tier-3"
  }

  return async function intercept(input: ToolInput, output: ToolOutput): Promise<void> {
    const toolName = String(input?.tool ?? "").toLowerCase()
    if (!interceptTools.has(toolName)) return

    const args = output?.args
    if (!args || typeof args !== "object") return

    const prompt = extractPrompt(args as Record<string, unknown>)
    if (!prompt) return

    const agent = extractAgentName(args as Record<string, unknown>)
    if (agent && excludeAgents.has(agent)) return

    // One-shot override takes highest priority (consumed on use)
    const oneShotOverride = sessionOverrides?.consumeOneShot(input.sessionID)
    if (oneShotOverride) {
      const modelValue: Record<string, string> = {
        providerID: oneShotOverride.providerID,
        modelID: oneShotOverride.modelID,
      }
      if (oneShotOverride.variant) {
        modelValue.variant = oneShotOverride.variant
      }

      ;(args as Record<string, unknown>).model = modelValue
      onRouted?.({ model: oneShotOverride, reason: "one-shot", tool: toolName, agent: agent ?? undefined })
      return
    }

    // Persistent session override
    const rememberedOverride = sessionOverrides?.get(input.sessionID)
    if (rememberedOverride) {
      const modelValue: Record<string, string> = {
        providerID: rememberedOverride.providerID,
        modelID: rememberedOverride.modelID,
      }
      if (rememberedOverride.variant) {
        modelValue.variant = rememberedOverride.variant
      }

      ;(args as Record<string, unknown>).model = modelValue
      onRouted?.({ model: rememberedOverride, reason: "persistent-override", tool: toolName, agent: agent ?? undefined })
      return
    }

    const tier = await classifyPrompt(prompt)
    const resolved = tierMap[tier]
    if (!resolved) return

    const modelValue: Record<string, string> = {
      providerID: resolved.providerID,
      modelID: resolved.modelID,
    }
    if (resolved.variant) {
      modelValue.variant = resolved.variant
    }

    ;(args as Record<string, unknown>).model = modelValue
    onRouted?.({ model: resolved, tier, reason: "tier-classification", tool: toolName, agent: agent ?? undefined })
  }
}
