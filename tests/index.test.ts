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

  it("returns instead of blocking forever when provider discovery hangs", async () => {
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

    const pluginPromise = WorkloadRouter({
      client: {
        provider: {
          list: () => new Promise(() => {}),
        },
      },
    } as never)

    const outcome = await Promise.race([
      pluginPromise.then(() => "resolved"),
      vi.advanceTimersByTimeAsync(3_500).then(() => "timed-out"),
    ])

    expect(outcome).toBe("resolved")
    await expect(pluginPromise).resolves.toEqual({})

    fs.rmSync(tempConfigHome, { recursive: true, force: true })
  })
})
