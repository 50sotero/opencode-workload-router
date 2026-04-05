export const TIER_INSTRUCTION_TEXT = `When delegating tasks to subagents, assess the complexity and prefix your delegation prompt with a tier tag:

  [tier-1] — Trivial: file lookup, grep, simple question, read-only
  [tier-2] — Standard: single-file edit, write a test, moderate reasoning
  [tier-3] — Heavy: multi-file refactor, debugging, feature implementation
  [tier-4] — Critical: architecture, system design, complex debugging

Example: "[tier-1] Find all files importing the auth module"

If you omit the tag, the system will classify automatically.`

type SystemTransformInput = {
  sessionID?: string
  model: any
}

type SystemTransformOutput = {
  system: string[]
}

export function createSystemPromptHook() {
  return async function hook(
    _input: SystemTransformInput,
    output: SystemTransformOutput,
  ): Promise<void> {
    if (output.system.includes(TIER_INSTRUCTION_TEXT)) return
    output.system.push(TIER_INSTRUCTION_TEXT)
  }
}
