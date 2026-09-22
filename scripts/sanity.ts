// Sanity gate — refuse to run against a Kyneta/loro build that is known-bad.
//
// Two deterministic markers, per 04-roadmap.md's fitness functions. These are
// cheaper and far less flaky than a wall-clock throughput budget:
//   - `stepInPlace` is absent from the published @kyneta/schema 3.0.0 dist, so
//     its presence proves we are on a build that carries the O(δ) write fix.
//   - loro-crdt < 1.13.4 builds a commit's event in O(keys²) whenever a
//     subscriber is attached — which, for the Loro substrate, is always.
import { createRequire } from "node:module"
import { checkEnvironment } from "@pineta/core"

const require = createRequire(import.meta.url)

const schema = await import("@kyneta/schema")
const loroVersion: string = require("loro-crdt/package.json").version

const hasStepInPlace = typeof schema.stepInPlace === "function"
const report = checkEnvironment({ hasStepInPlace, loroVersion })

console.log(
  `  @kyneta/schema stepInPlace : ${hasStepInPlace ? "present" : "MISSING"}`,
)
console.log(`  loro-crdt                  : ${loroVersion} (floor 1.13.4)`)
console.log(
  `  @kyneta/schema resolved    : ${require.resolve("@kyneta/schema")}`,
)

if (!report.ok) {
  console.error(`\nsanity: FAILED — ${report.problems.join("; ")}`)
  process.exit(1)
}
console.log("\nsanity: ok")
