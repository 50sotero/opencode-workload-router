// Tests for the heuristic classifier — zero-cost first pass in the classification chain.
import { describe, it, expect } from "vitest"
import { classifyHeuristic } from "../src/heuristic"

describe("classifyHeuristic", () => {
  describe("tier-1: trivial tasks", () => {
    it("classifies short prompts with no code as tier-1", () => {
      const result = classifyHeuristic("find all TODO comments")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies grep/search tasks as tier-1", () => {
      const result = classifyHeuristic("grep for all imports of auth module")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies explain requests as tier-1", () => {
      const result = classifyHeuristic("what is this function doing?")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("classifies list/read tasks as tier-1", () => {
      const result = classifyHeuristic("list all files in src/utils")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })
  })

  describe("tier-2: standard tasks", () => {
    it("classifies single-file edits as tier-2", () => {
      const result = classifyHeuristic("fix the typo in src/config.ts")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })

    it("classifies test writing as tier-2", () => {
      const result = classifyHeuristic("write a test for the parseConfig function")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })

    it("classifies rename tasks as tier-2", () => {
      const result = classifyHeuristic("rename the variable foo to barCount in utils.ts")
      expect(result).toEqual({ tier: "tier-2", confidence: "high" })
    })
  })

  describe("tier-3: heavy tasks", () => {
    it("classifies multi-file refactors as tier-3", () => {
      const result = classifyHeuristic("refactor the auth module across all files")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })

    it("classifies debugging tasks as tier-3", () => {
      const result = classifyHeuristic("debug why the login flow fails on redirect")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })

    it("classifies feature implementation as tier-3", () => {
      const result = classifyHeuristic("implement pagination for the user list endpoint")
      expect(result).toEqual({ tier: "tier-3", confidence: "high" })
    })
  })

  describe("tier-4: critical tasks", () => {
    it("classifies architecture tasks as tier-4", () => {
      const result = classifyHeuristic("architect a distributed caching layer from scratch")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })

    it("classifies long prompts with design language as tier-4", () => {
      const longPrompt = "Design a new authentication system that supports OAuth2, SAML, and API keys. " +
        "It needs to handle distributed sessions across multiple regions with consistent hashing. " +
        "The system should support rate limiting per tenant and have a migration path from the current JWT-based auth. " +
        "Consider security implications including token rotation, revocation, and audit logging. " +
        "```typescript\ninterface AuthProvider {\n  authenticate(token: string): Promise<Session>\n  refresh(session: Session): Promise<Session>\n}\n```" +
        "The infrastructure should be horizontally scalable and support blue-green deployments."
      const result = classifyHeuristic(longPrompt)
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })
  })

  describe("ambiguous prompts", () => {
    it("returns low confidence for ambiguous prompts", () => {
      const result = classifyHeuristic("work on the user profile page")
      expect(result.confidence).toBe("low")
    })

    it("returns low confidence for medium-length prompts without clear signals", () => {
      const result = classifyHeuristic("update the configuration to handle the new format properly")
      expect(result.confidence).toBe("low")
    })
  })

  describe("tier tag extraction", () => {
    it("extracts explicit tier-1 tag", () => {
      const result = classifyHeuristic("[tier-1] find all TODO comments")
      expect(result).toEqual({ tier: "tier-1", confidence: "high" })
    })

    it("extracts explicit tier-4 tag", () => {
      const result = classifyHeuristic("[tier-4] redesign the auth system")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })

    it("tier tag takes priority over heuristic", () => {
      const result = classifyHeuristic("[tier-4] fix a typo")
      expect(result).toEqual({ tier: "tier-4", confidence: "high" })
    })
  })
})
