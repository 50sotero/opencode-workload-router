// Heuristic classifier — zero-cost first pass in the classification chain.
// Handles explicit tier tags and keyword/token analysis. Returns low confidence
// for ambiguous prompts so they fall through to the small-model classifier.
import type { TierName, HeuristicResult } from "./types.js"

const TIER_TAG_PATTERN = /^\[tier-([1-4])\]\s*/i

const TIER_1_VERBS = [
  "grep", "find", "read", "list", "search", "look", "check",
  "what is", "what does", "explain", "show", "print", "count",
  "where is", "how many",
]

const TIER_2_VERBS = [
  "edit", "fix", "rename", "add", "remove", "update", "test",
  "write test", "change", "replace", "move", "delete", "insert",
]

// "write" only counts as tier-2 when paired with "test"
const TIER_2_WRITE_TEST_PATTERN = /\bwrite\s+(?:a\s+)?test\b/i

const TIER_3_KEYWORDS = [
  "refactor", "debug", "implement", "feature", "integrate", "migrate",
  "across all", "project-wide", "multiple files", "codebase",
]

// "all files" is tier-3 only when an action verb is also present (not just listing).
const TIER_3_ALL_FILES_PATTERN = /\ball\s+files\b/i

const TIER_4_KEYWORDS = [
  "architect", "design", "system", "infrastructure", "migration",
  "from scratch", "distributed", "scalable", "security audit",
  "performance", "redesign", "overhaul",
]

// A file reference suggests a focused single-file task (tier-2 with high confidence).
// Matches paths like src/config.ts, utils.ts, *.js, etc.
const FILE_REFERENCE_PATTERN = /\b[\w/-]+\.\w{1,5}\b/

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3)
}

function hasCodeBlocks(text: string): boolean {
  return CODE_BLOCK_PATTERN.test(text)
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw))
}

function hasTier2Verb(text: string): boolean {
  if (TIER_2_WRITE_TEST_PATTERN.test(text)) return true
  return matchesAny(text, TIER_2_VERBS)
}

// "all files" is only a tier-3 signal when combined with an action verb, not just listing.
function matchesTier3(text: string): boolean {
  if (matchesAny(text, TIER_3_KEYWORDS)) return true
  if (TIER_3_ALL_FILES_PATTERN.test(text) && hasTier2Verb(text)) return true
  return false
}

export function classifyHeuristic(prompt: string): HeuristicResult {
  // 1. Explicit tier tag from the main agent — always wins.
  const tagMatch = prompt.match(TIER_TAG_PATTERN)
  if (tagMatch) {
    const tierNum = tagMatch[1] as "1" | "2" | "3" | "4"
    return { tier: `tier-${tierNum}` as TierName, confidence: "high" }
  }

  const lower = prompt.toLowerCase()
  const tokens = estimateTokens(prompt)
  const hasCode = hasCodeBlocks(prompt)
  const hasTier4 = matchesAny(prompt, TIER_4_KEYWORDS)
  const hasTier3 = matchesTier3(prompt)

  // 2. Tier-4: long prompt + code block + design language.
  if (tokens > 500 && hasCode && hasTier4) {
    return { tier: "tier-4", confidence: "high" }
  }

  // 3. Tier-4: multiple architecture keywords (>=2 = clearly architectural).
  const tier4MatchCount = TIER_4_KEYWORDS.filter(kw => lower.includes(kw)).length
  if (tier4MatchCount >= 2) {
    return { tier: "tier-4", confidence: "high" }
  }

  // 4. Tier-3: multi-file or complex operation keywords.
  if (hasTier3) {
    return { tier: "tier-3", confidence: "high" }
  }

  // 5. Tier-1: read-only verbs with no edit/complex signals.
  if (
    matchesAny(prompt, TIER_1_VERBS) &&
    !hasTier2Verb(prompt) &&
    !hasTier3 &&
    !hasTier4
  ) {
    return { tier: "tier-1", confidence: "high" }
  }

  // 6. Tier-2: write-test pattern is specific enough even without a file reference.
  if (TIER_2_WRITE_TEST_PATTERN.test(prompt) && !hasTier3 && !hasTier4) {
    return { tier: "tier-2", confidence: "high" }
  }

  // 7. Tier-2: edit verbs AND a specific file reference — confident single-file task.
  //    Without a file reference, a tier-2 verb alone is ambiguous.
  if (hasTier2Verb(prompt) && !hasTier3 && !hasTier4 && FILE_REFERENCE_PATTERN.test(prompt)) {
    return { tier: "tier-2", confidence: "high" }
  }

  // 8. Ambiguous — fall through to small-model classifier.
  return { tier: "tier-3", confidence: "low" }
}
