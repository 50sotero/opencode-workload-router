import { describe, it, expect } from "vitest"
import { createSystemPromptHook, TIER_INSTRUCTION_TEXT } from "../src/system-prompt"

describe("createSystemPromptHook", () => {
  it("appends tier instructions to system prompt array", async () => {
    const hook = createSystemPromptHook()
    const output = { system: ["You are a helpful assistant."] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(2)
    expect(output.system[1]).toBe(TIER_INSTRUCTION_TEXT)
  })

  it("works with empty system array", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [] as string[] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toBe(TIER_INSTRUCTION_TEXT)
  })

  it("does not duplicate if already present", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [TIER_INSTRUCTION_TEXT] }
    await hook({ model: {} as any }, output)
    expect(output.system).toHaveLength(1)
  })
})
