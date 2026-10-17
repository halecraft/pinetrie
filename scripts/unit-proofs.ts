// scripts/unit-proofs — every unit mutation's `expect` names a test its
// command runs (`unitExpectGaps`). Run: pnpm run proofs:unit, a step of
// `pnpm run verify`. It lists every test through Vitest, which takes seconds
// of collection, so it is a step of its own rather than a unit test.

import { execFileSync } from "node:child_process"
import path from "node:path"
import { loadMutationLists } from "./mutate.ts"
import { type ListedTest, unitExpectGaps } from "./proofs.ts"

const root = path.join(import.meta.dirname, "..")
const dir = path.join(import.meta.dirname, "mutations")

// `--staticParse=false` runs each file to collect it: a static parse, Vitest's
// default from 5, lists a `test.each` by its template ("%s"), not its cases.
const listed = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "vitest", "list", "--json", "--staticParse=false"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    },
  ),
) as readonly { readonly file: string; readonly name: string }[]
const tests: readonly ListedTest[] = listed.map(t => ({
  file: path.relative(root, t.file),
  name: t.name,
}))

let gaps = 0
for (const { file, mutations } of await loadMutationLists(dir)) {
  for (const gap of unitExpectGaps(mutations, tests)) {
    gaps++
    console.log(`  ${file}: ${gap.mutation}: ${gap.why}`)
  }
}
console.log(
  gaps === 0
    ? `every unit mutation names a test (${tests.length} tests)`
    : `${gaps} unit mutation(s) name no test their command runs`,
)
process.exit(gaps === 0 ? 0 : 1)
