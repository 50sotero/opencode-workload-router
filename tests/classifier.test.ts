import { describe, it, expect, vi } from "vitest"
import { classifyWithModel, CLASSIFIER_SYSTEM_PROMPT } from "../src/classifier"
import type { TierName } from "../src/types"

describe("classifyWithModel", () => {
  it("returns parsed tier from valid model response", async () => {
    const mockSend = vi.fn().mockResolvedValue("tier-2")
    const result = await classifyWithModel("fix the config parser", mockSend)
    expect(result).toBe("tier-2")
    expect(mockSend).toHaveBeenCalledWith(
      CLASSIFIER_SYSTEM_PROMPT,
      "fix the config parser",
    )
  })

  it("trims whitespace from model response", async () => {
    const mockSend = vi.fn().mockResolvedValue("  tier-3\n ")
    const result = await classifyWithModel("implement feature", mockSend)
    expect(result).toBe("tier-3")
  })

  it("returns null on invalid tier response", async () => {
    const mockSend = vi.fn().mockResolvedValue("I think this is a complex task")
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null on empty response", async () => {
    const mockSend = vi.fn().mockResolvedValue("")
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null when send function throws", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("timeout"))
    const result = await classifyWithModel("do something", mockSend)
    expect(result).toBeNull()
  })

  it("returns null when send function times out", async () => {
    const mockSend = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve("tier-1"), 5000))
    )
    const result = await classifyWithModel("do something", mockSend, 100)
    expect(result).toBeNull()
  })
})
