import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const runtimeFiles = [
  "bin/init.ts",
  "src/classifier.ts",
  "src/config.ts",
  "src/heuristic.ts",
  "src/index.ts",
  "src/init-config.ts",
  "src/init-opencode.ts",
  "src/interceptor.ts",
  "src/tier-resolver.ts",
]

describe("runtime import specifiers", () => {
  it("use .js extensions for relative ESM imports", () => {
    for (const relativePath of runtimeFiles) {
      const absolutePath = path.join(process.cwd(), relativePath)
      const source = fs.readFileSync(absolutePath, "utf-8")
      const matches = source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)

      for (const match of matches) {
        expect(match[1], `${relativePath} has a Node-incompatible relative import`).toMatch(/\.js$/)
      }
    }
  })
})
