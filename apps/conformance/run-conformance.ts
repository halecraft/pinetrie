// SPIKE S2 runner: runs pi's own Storage conformance suite against an
// implementation, prints a per-case pass/fail table and a failure taxonomy.
//
//   node run-conformance.mjs kyneta   (default)
//   node run-conformance.mjs memory   (control / baseline)

const { createRequire } = await import("node:module")
const require_ = createRequire(import.meta.url)
const PAC = require_
  .resolve("@earendil-works/pi-agent-core/package.json")
  .replace(/\/package\.json$/, "")

const { createStorageConformance } = await import(
  `${PAC}/dist/harness/session/testing/conformance/storage.js`
)

const target = process.argv[2] ?? "kyneta"

// pi's conformance suite takes a fixture factory: () => Promise<{storage}>.
let factory: () => Promise<{ storage: unknown } & AsyncDisposable>
if (target === "memory") {
  const { MemoryStorage } = await import(
    `${PAC}/dist/harness/session/memory.js`
  )
  factory = async () => {
    const storage = new MemoryStorage()
    return { storage, async [Symbol.asyncDispose]() {} }
  }
} else {
  const { KynetaStorage } = await import("@pinetrie/pi")
  const { threadIdFor } = await import("@pinetrie/core")
  factory = async () => {
    // pi's suite commits entries outside any thread; pine·trie's never do
    // (ADR-0125), so only this storage is given a thread to fall back to.
    const storage = new KynetaStorage({
      fallbackThread: threadIdFor("c0f0a0ce"),
    })
    return { storage, async [Symbol.asyncDispose]() {} }
  }
}

const cases = createStorageConformance(factory)
const results = []

for (const c of cases) {
  const started = performance.now()
  try {
    await c.run()
    results.push({
      group: c.group,
      name: c.name,
      ok: true,
      ms: performance.now() - started,
    })
  } catch (error) {
    results.push({
      group: c.group,
      name: c.name,
      ok: false,
      ms: performance.now() - started,
      error,
    })
  }
}

console.log(`\n=== Storage conformance: ${target} ===\n`)
let group = ""
for (const r of results) {
  if (r.group !== group) {
    group = r.group
    console.log(`  [${group}]`)
  }
  console.log(
    `    ${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.ms.toFixed(0)}ms)`,
  )
}

const passed = results.filter(r => r.ok).length
const failed = results.filter(r => !r.ok)
console.log(
  `\n  TOTAL: ${passed}/${results.length} passed, ${failed.length} failed\n`,
)

if (failed.length > 0) {
  console.log("=== failure detail ===\n")
  for (const r of failed) {
    console.log(`--- ${r.group} / ${r.name}`)
    const message =
      r.error instanceof Error
        ? (r.error.stack ?? r.error.message)
        : String(r.error)
    console.log(
      message
        .split("\n")
        .slice(0, 14)
        .map(l => `    ${l}`)
        .join("\n"),
    )
    console.log()
  }
}

process.exit(failed.length === 0 ? 0 : 1)
