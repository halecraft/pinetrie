// Package boundaries are enforced by MODULE RESOLUTION: an import a package
// does not declare fails to resolve, at type-check time (TS2307) and at run
// time. That holds only if the manifests say the right things. This file
// checks the manifests, and the one resolution property everything rests on.
//
// It replaced scripts/check-boundaries.ts, a regex scanner that failed silently
// three times. Nothing here reads source text.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { test } from "vitest"

interface Manifest {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const read = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(ROOT, dir, "package.json"), "utf8"))
const dirsIn = (group: string) =>
  readdirSync(path.join(ROOT, group), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => `${group}/${d.name}`)

const WORKSPACE = [...dirsIn("apps"), ...dirsIn("packages")]
const deps = (m: Manifest) => Object.keys(m.dependencies ?? {})
const allDeps = (m: Manifest) => [
  ...deps(m),
  ...Object.keys(m.devDependencies ?? {}),
]

/**
 * The root's tooling, exactly. The root's node_modules is visible to every
 * package (Node resolves by walking up), so this list IS the residue every
 * package can reach. Adding to it widens what every package can import.
 */
const ROOT_TOOLING = [
  "@biomejs/biome",
  "@playwright/test",
  "@types/node",
  "typescript",
  "vitest",
]

test("the root declares tooling only, so nothing runtime leaks to packages", () => {
  const root = read(".")
  assert.deepEqual(deps(root), [], "the root must have no dependencies")
  assert.deepEqual(Object.keys(root.devDependencies ?? {}).sort(), ROOT_TOOLING)
})

test("only the pi adapter and the conformance suite declare pi (ADR-0003)", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).some(d => d.startsWith("@earendil-works/")),
  ).sort()
  assert.deepEqual(declaring, ["apps/conformance", "packages/pi"])
})

test("core declares nothing", () => {
  assert.deepEqual(allDeps(read("packages/core")), [])
})

test("the protocol declares only Kyneta and core", () => {
  const extra = deps(read("packages/protocol")).filter(
    d => !d.startsWith("@kyneta/") && d !== "@pineta/core",
  )
  assert.deepEqual(extra, [])
})

test("marginalia declares only TypeBox and core", () => {
  assert.deepEqual(deps(read("packages/marginalia")).sort(), [
    "@pineta/core",
    "typebox",
  ])
})

test("reads declares only core, schema and marginalia: no pi, no transport", () => {
  // The host and the client decide from these reads, so they must run in both.
  assert.deepEqual(deps(read("packages/reads")).sort(), [
    "@pineta/core",
    "@pineta/marginalia",
    "@pineta/schema",
  ])
})

test("workspaces declares only core: it runs jj, never pi or the document", () => {
  assert.deepEqual(deps(read("packages/workspaces")), ["@pineta/core"])
})

test("the client declares no server package and no app", () => {
  const client = deps(read("packages/client"))
  for (const forbidden of [
    "ws",
    "vite",
    "@pineta/app",
    "@pineta/pi",
    "@pineta/workspaces",
  ]) {
    assert.ok(
      !client.includes(forbidden),
      `client must not depend on ${forbidden}`,
    )
  }
})

test("nothing depends on an app: apps are run, never imported", () => {
  const apps = new Set(dirsIn("apps").map(dir => read(dir).name))
  for (const dir of WORKSPACE) {
    const onApp = allDeps(read(dir)).filter(d => apps.has(d))
    assert.deepEqual(onApp, [], `${dir} depends on an app`)
  }
})

test("every workspace:* dependency names a package that exists", () => {
  const names = new Set(WORKSPACE.map(dir => read(dir).name))
  for (const dir of WORKSPACE) {
    const m = read(dir)
    const wanted = Object.entries({ ...m.dependencies, ...m.devDependencies })
      .filter(([, spec]) => spec.startsWith("workspace:"))
      .map(([name]) => name)
    for (const name of wanted)
      assert.ok(names.has(name), `${dir} wants ${name}`)
  }
})

test("resolution: core cannot reach what other packages declare", () => {
  // The claim everything above rests on, asserted rather than assumed. Before
  // the split the root declared these, and core resolved every one of them.
  //
  // Measured in a CHILD process with NODE_PATH cleared. Vitest runs under a
  // pnpm shim that sets NODE_PATH to pnpm's hidden hoist directory, where
  // everything resolves from anywhere. Probing in-process measured the test
  // runner, not the app, which runs as plain `node`.
  const probe = `
    const r = require("node:module").createRequire(${JSON.stringify(path.join(ROOT, "packages/core/index.ts"))})
    const leaked = ${JSON.stringify(PROBED)}.filter(s => { try { r.resolve(s); return true } catch { return false } })
    process.stdout.write(JSON.stringify(leaked))`
  const out = spawnSync(process.execPath, ["-e", probe], {
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
  })
  assert.equal(out.status, 0, out.stderr)
  assert.deepEqual(
    JSON.parse(out.stdout),
    [],
    "core resolved an undeclared package",
  )
})

/** What core must NOT be able to reach: each is declared by some other package. */
const PROBED = [
  "ws",
  "vite",
  "@kyneta/exchange",
  "react",
  "@earendil-works/pi-agent-core",
]
