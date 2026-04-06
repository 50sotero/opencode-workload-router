import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as {
  main: string
  types: string
  bin: Record<string, string>
  exports: { ".": { import: string; types: string } }
}

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

  it("package entrypoints point at built files", () => {
    const builtPaths = [
      packageJson.main,
      packageJson.types,
      packageJson.bin["opencode-workload-router"],
      packageJson.exports["."].import,
      packageJson.exports["."].types,
    ]

    for (const relativePath of builtPaths) {
      expect(fs.existsSync(path.join(process.cwd(), relativePath)), `${relativePath} should exist after build`).toBe(true)
    }
  })
})
