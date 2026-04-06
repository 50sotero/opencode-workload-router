import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkloadRouter } from "../src/index"

const originalConfigHome = process.env.XDG_CONFIG_HOME

describe("WorkloadRouter startup", () => {
  afterEach(() => {
    process.env.XDG_CONFIG_HOME = originalConfigHome
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("returns hooks instead of blocking forever when provider discovery hangs", async () => {
    const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "workload-router-startup-"))
    const opencodeDir = path.join(tempConfigHome, "opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(opencodeDir, "workload-router.json"),
      JSON.stringify({
        enabled: true,
        provider_priority: ["openai"],
        exclude_agents: [],
        intercept_tools: ["task"],
      }),
      "utf-8",
    )

    process.env.XDG_CONFIG_HOME = tempConfigHome
    vi.useFakeTimers()

    const providerList = vi.fn(() => new Promise(() => {}))

    const pluginPromise = WorkloadRouter({
      client: {
        provider: {
          list: providerList,
        },
      },
    } as never)

    const outcome = await Promise.race([
      pluginPromise.then(() => "resolved"),
      vi.advanceTimersByTimeAsync(3_500).then(() => "timed-out"),
    ])

    expect(outcome).toBe("resolved")
    const plugin = await pluginPromise
    expect(providerList).not.toHaveBeenCalled()
    expect(plugin).toHaveProperty("chat.message")
    expect(plugin).toHaveProperty("experimental.chat.system.transform")
    expect(plugin).toHaveProperty("tool.execute.before")

    fs.rmSync(tempConfigHome, { recursive: true, force: true })
  })

  it("returns hooks before provider discovery and resolves providers on first intercepted tool call", async () => {
    const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "workload-router-lazy-init-"))
    const opencodeDir = path.join(tempConfigHome, "opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(opencodeDir, "workload-router.json"),
      JSON.stringify({
        enabled: true,
        provider_priority: ["openai"],
        exclude_agents: [],
        intercept_tools: ["task"],
      }),
      "utf-8",
    )

    process.env.XDG_CONFIG_HOME = tempConfigHome

    const providerList = vi.fn().mockResolvedValue({
      data: {
        connected: ["openai"],
        all: [
          {
            id: "openai",
            models: {
              "gpt-5.2-codex": {
                id: "gpt-5.2-codex",
                tool_call: true,
                reasoning: false,
                limit: { context: 400000, output: 128000 },
              },
            },
          },
        ],
      },
    })

    const plugin = await WorkloadRouter({
      client: {
        provider: { list: providerList },
      },
    } as never)

    expect(providerList).not.toHaveBeenCalled()
    expect(plugin).toHaveProperty("tool.execute.before")

    const intercept = plugin["tool.execute.before"] as (input: unknown, output: unknown) => Promise<void>
    const output = { args: { prompt: "[tier-1] say hello", subagent_type: "explore" } }

    await intercept(
      { tool: "task", sessionID: "session-1", callID: "call-1" },
      output,
    )

    expect(providerList).toHaveBeenCalledTimes(1)
    expect(output.args.model).toEqual({ providerID: "openai", modelID: "gpt-5.2-codex" })

    fs.rmSync(tempConfigHome, { recursive: true, force: true })
  })
})
