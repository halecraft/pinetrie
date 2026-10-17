import { laneIgnores } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { isSourceChange } from "./watch.ts"

const files = [{ dir: "", text: "node_modules/\ndist/\n" }]
const own = laneIgnores([".plans"])

test("isSourceChange: a source path changed; only ignored ones, or pine·trie's own, did not", () => {
  const change = (...paths: string[]) => isSourceChange({ paths, files, own })
  expect(change("src/a.ts")).toBe(true)
  expect(change("node_modules/x/index.js", "src/a.ts")).toBe(true)
  expect(change("node_modules/x/index.js", "dist/out.js")).toBe(false)
  expect(change(".jj/repo/op_heads", ".plans/p.md")).toBe(false)
  expect(change(".gitignore")).toBe(true)
})

test("isSourceChange: an accept's staging directory is none; a write into its asides is one", () => {
  const change = (...paths: string[]) => isSourceChange({ paths, files, own })
  expect(change(".pinetrie-accept-1/a.txt")).toBe(false)
  expect(change(".pinetrie-aside-1/a.txt")).toBe(true)
})
