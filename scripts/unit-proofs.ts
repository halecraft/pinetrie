// scripts/unit-proofs — every unit mutation's `expect` names a test its
// command runs (`unitExpectGaps`). Run: pnpm run proofs:unit, a step of
// `pnpm run verify`. It lists every test through Vitest, which takes seconds
// of collection, so it is a step of its own rather than a unit test.

import path from "node:path"
import { listTests, loadMutationLists } from "./mutate.ts"
import { unitExpectGaps } from "./proofs.ts"

const root = path.join(import.meta.dirname, "..")
const dir = path.join(import.meta.dirname, "mutations")
const tests = listTests(root, [])

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
