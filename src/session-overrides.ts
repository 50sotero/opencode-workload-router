import type { ResolvedModel } from "./types.js"

type ProviderModel = {
  id: string
}

type ProviderData = {
  id: string
  models: Record<string, ProviderModel>
}

type ChatMessageInput = {
  sessionID: string
}

type ChatMessagePart = {
  type?: string
  text?: string
}

type ChatMessageOutput = {
  message: unknown
  parts: ChatMessagePart[]
}

type OverrideInstruction =
  | { action: "set"; modelQuery: string }
  | { action: "clear" }

const FUTURE_SUBAGENT_SCOPE = String.raw`future\s+subagent(?:\s+(?:deployments?|tasks?|spawns?))?`

const SET_OVERRIDE_PATTERNS = [
  new RegExp(
    String.raw`^\s*(?:please\s+)?(?:from\s+now\s+on|going\s+forward)[\s,:-]*(?:please\s+)?use\s+(.+?)\s+for\s+${FUTURE_SUBAGENT_SCOPE}[.!?\s]*$`,
    "i",
  ),
  new RegExp(
    String.raw`^\s*(?:please\s+)?use\s+(.+?)\s+for\s+${FUTURE_SUBAGENT_SCOPE}[.!?\s]*$`,
    "i",
  ),
]

const CLEAR_OVERRIDE_PATTERNS = [
  new RegExp(
    String.raw`^\s*(?:please\s+)?(?:go\s+back\s+to|resume|switch\s+back\s+to)\s+(?:normal\s+)?(?:workload|automatic)\s+routing(?:\s+for\s+${FUTURE_SUBAGENT_SCOPE})?[.!?\s]*$`,
    "i",
  ),
  /^\s*(?:please\s+)?clear\s+(?:the\s+)?subagent\s+model\s+override[.!?\s]*$/i,
  /^\s*(?:please\s+)?stop\s+forcing\s+(?:a\s+)?subagent\s+model[.!?\s]*$/i,
]

export type SessionModelOverrideStore = {
  get(sessionID: string): ResolvedModel | undefined
  set(sessionID: string, model: ResolvedModel): void
  clear(sessionID: string): void
}

export function createSessionModelOverrideStore(): SessionModelOverrideStore {
  const overrides = new Map<string, ResolvedModel>()

  return {
    get(sessionID) {
      return overrides.get(sessionID)
    },
    set(sessionID, model) {
      overrides.set(sessionID, model)
    },
    clear(sessionID) {
      overrides.delete(sessionID)
    },
  }
}

function extractMessageText(parts: ChatMessagePart[]): string {
  return parts
    .filter((part): part is ChatMessagePart & { type: string; text: string } => (
      part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0
    ))
    .map(part => part.text.trim())
    .join("\n")
    .trim()
}

function parseOverrideInstruction(text: string): OverrideInstruction | null {
  if (text.length === 0) return null

  if (CLEAR_OVERRIDE_PATTERNS.some(pattern => pattern.test(text))) {
    return { action: "clear" }
  }

  for (const pattern of SET_OVERRIDE_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue

    const modelQuery = match[1]?.trim()
    if (!modelQuery) return null
    return { action: "set", modelQuery }
  }

  return null
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function isSpecificEnoughQuery(modelQuery: string): boolean {
  const tokens = tokenize(modelQuery)
  const normalized = normalize(modelQuery)
  return tokens.length >= 2 || normalized.length >= 6
}

function scoreModelMatch(modelQuery: string, providerID: string, modelID: string): number {
  const queryNormalized = normalize(modelQuery)
  const modelNormalized = normalize(modelID)
  const combinedNormalized = normalize(`${providerID}/${modelID}`)

  if (!queryNormalized) return 0

  const queryTokens = tokenize(modelQuery)
  const candidateTokens = new Set(tokenize(`${providerID} ${modelID}`))

  let score = 0

  if (combinedNormalized === queryNormalized) score += 120
  if (modelNormalized === queryNormalized) score += 110
  if (modelNormalized.startsWith(queryNormalized)) score += 80
  if (combinedNormalized.startsWith(queryNormalized)) score += 70
  if (modelNormalized.includes(queryNormalized)) score += 60
  if (combinedNormalized.includes(queryNormalized)) score += 50

  if (queryTokens.length > 0 && queryTokens.every(token => candidateTokens.has(token))) {
    score += 40
  }

  if (queryTokens.length > 0 && queryTokens.every(token => modelNormalized.includes(token))) {
    score += 20
  }

  return score
}

function orderConnectedProviders(
  providers: ProviderData[],
  connectedProviderIds: string[],
  providerPriority: string[],
): ProviderData[] {
  const connectedSet = new Set(connectedProviderIds)
  const seen = new Set<string>()
  const ordered: ProviderData[] = []

  for (const providerID of providerPriority) {
    if (!connectedSet.has(providerID) || seen.has(providerID)) continue
    const provider = providers.find(item => item.id === providerID)
    if (!provider) continue
    seen.add(providerID)
    ordered.push(provider)
  }

  for (const providerID of connectedProviderIds) {
    if (seen.has(providerID)) continue
    const provider = providers.find(item => item.id === providerID)
    if (!provider) continue
    seen.add(providerID)
    ordered.push(provider)
  }

  for (const provider of providers) {
    if (!connectedSet.has(provider.id) || seen.has(provider.id)) continue
    seen.add(provider.id)
    ordered.push(provider)
  }

  return ordered
}

function resolveModelOverride(
  modelQuery: string,
  providers: ProviderData[],
  connectedProviderIds: string[],
  providerPriority: string[],
): ResolvedModel | undefined {
  if (!isSpecificEnoughQuery(modelQuery)) return undefined

  let bestMatch: { resolved: ResolvedModel; score: number } | undefined

  for (const provider of orderConnectedProviders(providers, connectedProviderIds, providerPriority)) {
    for (const model of Object.values(provider.models)) {
      const score = scoreModelMatch(modelQuery, provider.id, model.id)
      if (score <= 0) continue

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          resolved: { providerID: provider.id, modelID: model.id },
          score,
        }
      }
    }
  }

  return bestMatch?.resolved
}

export function createChatMessageHook(
  store: SessionModelOverrideStore,
  providers: ProviderData[],
  connectedProviderIds: string[],
  providerPriority: string[],
) {
  return async function chatMessageHook(
    input: ChatMessageInput,
    output: ChatMessageOutput,
  ): Promise<void> {
    const messageText = extractMessageText(output.parts)
    const instruction = parseOverrideInstruction(messageText)
    if (!instruction) return

    if (instruction.action === "clear") {
      store.clear(input.sessionID)
      return
    }

    const resolved = resolveModelOverride(
      instruction.modelQuery,
      providers,
      connectedProviderIds,
      providerPriority,
    )

    if (!resolved) return

    store.set(input.sessionID, resolved)
  }
}
