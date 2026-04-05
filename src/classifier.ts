// Small-model classifier: sends a task prompt to a cheap LLM and parses the
// tier-N response. Accepts an injected send function to keep this module free
// of any SDK / provider coupling. Returns null on invalid response or timeout.
import type { TierName } from "./types"
import { TIER_NAMES } from "./types"

export const CLASSIFIER_SYSTEM_PROMPT = `You are a task complexity classifier for an AI coding assistant subagent.
Given a developer's task description, classify it into exactly one tier:
tier-1: trivial (grep, lookup, simple question, read-only)
tier-2: standard (single-file edit, write test, moderate reasoning)
tier-3: heavy (multi-file changes, debugging, feature implementation)
tier-4: critical (architecture, system design, complex debugging)
Return ONLY the tier name, nothing else.`

export type ClassifierSendFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>

const VALID_TIERS = new Set<string>(TIER_NAMES)

function parseTierResponse(response: string): TierName | null {
  const trimmed = response.trim().toLowerCase()
  if (VALID_TIERS.has(trimmed)) {
    return trimmed as TierName
  }
  // Try to extract tier-N from a longer response
  const match = trimmed.match(/tier-[1-4]/)
  if (match && VALID_TIERS.has(match[0])) {
    return match[0] as TierName
  }
  return null
}

export async function classifyWithModel(
  prompt: string,
  send: ClassifierSendFn,
  timeoutMs: number = 3000,
): Promise<TierName | null> {
  try {
    const response = await Promise.race([
      send(CLASSIFIER_SYSTEM_PROMPT, prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("classifier timeout")), timeoutMs)
      ),
    ])
    return parseTierResponse(response)
  } catch {
    return null
  }
}
