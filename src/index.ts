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

type RuntimeHooks = {
  chatMessageHook: ReturnType<typeof createChatMessageHook>
  interceptor: ReturnType<typeof createInterceptor>
}

const PROVIDER_LIST_TIMEOUT_MS = 3_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

export const WorkloadRouter: Plugin = async ({ client }) => {
  const config = loadConfig()

  if (!config.enabled) {
    console.log("[workload-router] Disabled in config")
    return {}
  }

  const sessionOverrides = createSessionModelOverrideStore()
  const systemPromptHook = createSystemPromptHook()

  async function buildRuntimeHooks(): Promise<RuntimeHooks | null> {
    let providers: ProviderData[] = []
    let connectedIds: string[] = []
    try {
      const providerResponse = await withTimeout(
        client.provider.list(),
        PROVIDER_LIST_TIMEOUT_MS,
        "Provider discovery",
      )
      if (providerResponse.data) {
        providers = providerResponse.data.all ?? []
        connectedIds = providerResponse.data.connected ?? []
      }
    } catch (err) {
      console.warn("[workload-router] Failed to query providers:", err)
      return null
    }

    if (connectedIds.length === 0) {
      console.warn("[workload-router] No connected providers found, disabling")
      return null
    }

    const tierMap = resolveTiers(
      providers,
      connectedIds,
      config.provider_priority,
      config.tier_overrides,
    )

    const filledTiers = Object.entries(tierMap).filter(([, v]) => v != null)
    if (filledTiers.length === 0) {
      console.warn("[workload-router] No tiers could be resolved, disabling")
      return null
    }

    console.log("[workload-router] Resolved tiers:")
    for (const [tier, model] of filledTiers) {
      if (!model) continue
      const variant = model.variant ? ` (variant: ${model.variant})` : ""
      console.log(`  ${tier}: ${model.providerID}/${model.modelID}${variant}`)
    }

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

    return {
      chatMessageHook: createChatMessageHook(
        sessionOverrides,
        providers,
        connectedIds,
        config.provider_priority,
      ),
      interceptor: createInterceptor(config, tierMap, classifierSend, sessionOverrides),
    }
  }

  let runtimeHooksPromise: Promise<RuntimeHooks | null> | null = null

  async function getRuntimeHooks(): Promise<RuntimeHooks | null> {
    if (!runtimeHooksPromise) {
      runtimeHooksPromise = buildRuntimeHooks().then((hooks) => {
        if (!hooks) runtimeHooksPromise = null
        return hooks
      }, (error) => {
        runtimeHooksPromise = null
        throw error
      })
    }

    return runtimeHooksPromise
  }

  return {
    "chat.message": async (input, output) => {
      const hooks = await getRuntimeHooks()
      if (!hooks) return
      await hooks.chatMessageHook(input, output)
    },
    "experimental.chat.system.transform": systemPromptHook,
    "tool.execute.before": async (input, output) => {
      const hooks = await getRuntimeHooks()
      if (!hooks) return
      await hooks.interceptor(input, output)
    },
  }
}

export default WorkloadRouter
