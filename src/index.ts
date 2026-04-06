// Plugin entry point — wires config, tier resolution, interceptor, and system
// prompt injection into the OpenCode plugin hook interface.
import type { Plugin } from "@opencode-ai/plugin"
import type { ClassifierSendFn } from "./classifier.js"
import { loadConfig } from "./config.js"
import { createInterceptor } from "./interceptor.js"
import {
  createChatMessageHook,
  createSessionModelOverrideStore,
} from "./session-overrides.js"
import { createSystemPromptHook } from "./system-prompt.js"
import { resolveTiers } from "./tier-resolver.js"

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

export const WorkloadRouter: Plugin = async ({ client }) => {
  const config = loadConfig()

  if (!config.enabled) {
    console.log("[workload-router] Disabled in config")
    return {}
  }

  // Query connected providers
  let providers: ProviderData[] = []
  let connectedIds: string[] = []
  try {
    const providerResponse = await client.provider.list()
    if (providerResponse.data) {
      providers = providerResponse.data.all ?? []
      connectedIds = providerResponse.data.connected ?? []
    }
  } catch (err) {
    console.warn("[workload-router] Failed to query providers:", err)
    return {}
  }

  if (connectedIds.length === 0) {
    console.warn("[workload-router] No connected providers found, disabling")
    return {}
  }

  // Resolve tier → model mapping
  const tierMap = resolveTiers(
    providers,
    connectedIds,
    config.provider_priority,
    config.tier_overrides,
  )

  const filledTiers = Object.entries(tierMap).filter(([, v]) => v != null)
  if (filledTiers.length === 0) {
    console.warn("[workload-router] No tiers could be resolved, disabling")
    return {}
  }

  console.log("[workload-router] Resolved tiers:")
  for (const [tier, model] of filledTiers) {
    if (!model) continue
    const variant = model.variant ? ` (variant: ${model.variant})` : ""
    console.log(`  ${tier}: ${model.providerID}/${model.modelID}${variant}`)
  }

  // Build classifier send function if a classifier model is available
  let classifierSend: ClassifierSendFn | null = null
  const classifierTierModel = tierMap["tier-1"]
  const classifierModelId = config.classifier_model
    ?? (classifierTierModel
      ? `${classifierTierModel.providerID}/${classifierTierModel.modelID}`
      : undefined)
  if (classifierModelId) {

    classifierSend = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const [providerID, ...modelParts] = classifierModelId.split("/")
      const modelID = modelParts.join("/")

      const session = await client.session.create()
      if (!session.data) throw new Error("Failed to create classifier session")

      const response = await client.session.prompt({
        path: { id: session.data.id },
        body: {
          model: { providerID, modelID },
          system: systemPrompt,
          parts: [{ type: "text", text: userPrompt }],
          noReply: false,
        },
      })

      // Extract text from response parts
      if (response.data?.parts) {
        for (const part of response.data.parts) {
          if ("text" in part && typeof part.text === "string") {
            return part.text
          }
        }
      }
      return ""
    }
  }

  const sessionOverrides = createSessionModelOverrideStore()
  const chatMessageHook = createChatMessageHook(
    sessionOverrides,
    providers,
    connectedIds,
    config.provider_priority,
  )
  const interceptor = createInterceptor(config, tierMap, classifierSend, sessionOverrides)
  const systemPromptHook = createSystemPromptHook()

  return {
    "chat.message": chatMessageHook,
    "experimental.chat.system.transform": systemPromptHook,
    "tool.execute.before": interceptor,
  }
}

export default WorkloadRouter
