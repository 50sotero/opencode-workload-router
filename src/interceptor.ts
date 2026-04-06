// Interceptor — hooked into tool.execute.before. Detects subagent tool calls,
// classifies the task prompt through the 3-level chain (tier tag → heuristic →
// small-model classifier), and rewrites output.args.model before dispatch.
import type { ClassifierSendFn } from "./classifier.js"
import { classifyWithModel } from "./classifier.js"
import { classifyHeuristic } from "./heuristic.js"
import type { TierName, TierMap, WorkloadRouterConfig, ResolvedModel } from "./types.js"

type ToolInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolOutput = {
  args: any
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
  const val = args.agent ?? args.agentName ?? args.name
  return typeof val === "string" ? val : null
}

export function createInterceptor(
  config: WorkloadRouterConfig,
  tierMap: TierMap,
  classifierSend: ClassifierSendFn | null,
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
  }
}
