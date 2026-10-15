// Package boundaries are enforced by MODULE RESOLUTION: an import a package
// does not declare fails to resolve, at type-check time (TS2307) and at run
// time. That holds only if the manifests say the right things. This file
// checks the manifests, and the one resolution property everything rests on.
//
// Nothing here reads source text: a regex scanner of imports failed silently
// three times.

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
const ROOT_TOOLING = ["@biomejs/biome", "@types/node", "typescript", "vitest"]

test("the root declares tooling only, so nothing runtime leaks to packages", () => {
  const root = read(".")
  assert.deepEqual(deps(root), [], "the root must have no dependencies")
  assert.deepEqual(Object.keys(root.devDependencies ?? {}).sort(), ROOT_TOOLING)
})

test("only the pi adapter and the conformance suite declare pi", () => {
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
    d => !d.startsWith("@kyneta/") && d !== "@pinetrie/core",
  )
  assert.deepEqual(extra, [])
})

test("rules declares only TypeBox, core, the markdown parser the client's remark wraps, and a .gitignore matcher", () => {
  // Which images a message shows is read from its markdown on the host, by
  // the parser under the client's remark-parse and remark-gfm, at the same
  // versions, so both read one tree and the bundle holds one copy. `ignore`
  // is behind its own export (`@pinetrie/rules/ignores`), which the page
  // never imports.
  assert.deepEqual(deps(read("packages/rules")).sort(), [
    "@pinetrie/core",
    "ignore",
    "mdast-util-from-markdown",
    "mdast-util-gfm",
    "micromark-extension-gfm",
    "typebox",
  ])
})

test("folder declares only core: it decides a folder project's history, and lanehost carries it out", () => {
  assert.deepEqual(deps(read("packages/folder")), ["@pinetrie/core"])
})

test("reads declares only core, schema and rules: no pi, no transport", () => {
  // The host and the client decide from these reads, so they must run in both.
  assert.deepEqual(deps(read("packages/reads")).sort(), [
    "@pinetrie/core",
    "@pinetrie/rules",
    "@pinetrie/schema",
  ])
})

test("session declares only Kyneta's exchange and WebSocket transport, core, protocol, reads, rules and schema: no React", () => {
  // It runs unchanged in a browser and in Node: the page draws from it, and
  // the suites drive a host through it. Declaring no React, it cannot draw.
  assert.deepEqual(deps(read("packages/session")).sort(), [
    "@kyneta/changefeed",
    "@kyneta/exchange",
    "@kyneta/machine",
    "@kyneta/schema",
    "@kyneta/transport",
    "@kyneta/websocket-transport",
    "@pinetrie/core",
    "@pinetrie/protocol",
    "@pinetrie/reads",
    "@pinetrie/rules",
    "@pinetrie/schema",
  ])
})

test("interface declares only core, protocol, reads, rules, schema, session, shell and TypeBox: no React, no DOM", () => {
  // What any client shows and does: a TTY must be able to take
  // it without a browser. `packages/interface/tsconfig.json` checks the DOM.
  assert.deepEqual(deps(read("packages/interface")).sort(), [
    "@pinetrie/core",
    "@pinetrie/protocol",
    "@pinetrie/reads",
    "@pinetrie/rules",
    "@pinetrie/schema",
    "@pinetrie/session",
    "@pinetrie/shell",
    "typebox",
  ])
})

test("shell declares only unbash: shell source as structure, nothing of pine·trie's", () => {
  assert.deepEqual(allDeps(read("packages/shell")), ["unbash"])
})

test("only interface declares shell: which call reads as shell is its decision", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).includes("@pinetrie/shell"),
  ).sort()
  assert.deepEqual(declaring, ["packages/interface"])
})

test("only the page and the app depend on interface: nothing below it does", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).includes("@pinetrie/interface"),
  ).sort()
  assert.deepEqual(declaring, ["apps/pinetrie", "packages/web"])
})

test("lanes declares only core: it runs jj and git in a lane, on a runtime it is handed, never pi or the document", () => {
  assert.deepEqual(deps(read("packages/lanes")), ["@pinetrie/core"])
})

/** The packages that run lanes, and the VM Docker runs in on the Mac. */
const RUNTIMES = ["@pinetrie/docker", "@pinetrie/vm"]

/** What a runtime may declare: core, lanes when it runs lanes, and lanehost with its channel for the disks. */
const RUNTIME_MAY = [
  "@pinetrie/channel",
  "@pinetrie/core",
  "@pinetrie/lanehost",
  "@pinetrie/lanes",
]

test("a runtime declares only core, lanes, and lanehost with its channel; never another runtime", () => {
  for (const dir of WORKSPACE) {
    const m = read(dir)
    if (m.name === undefined || !RUNTIMES.includes(m.name)) continue
    const extra = deps(m).filter(d => !RUNTIME_MAY.includes(d))
    assert.deepEqual(extra, [], `${m.name} declares ${extra.join(", ")}`)
  }
})

test("vm declares only core: it knows nothing of lanes", () => {
  assert.deepEqual(deps(read("packages/vm")), ["@pinetrie/core"])
})

test("only the app declares a runtime: it is the one place that picks one", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).some(d => RUNTIMES.includes(d)),
  ).sort()
  assert.deepEqual(declaring, ["apps/pinetrie"])
})

test("jj declares only core, keeper and lanes: it runs jj and git on your repo, never pi or the document", () => {
  assert.deepEqual(deps(read("packages/jj")).sort(), [
    "@pinetrie/core",
    "@pinetrie/keeper",
    "@pinetrie/lanes",
  ])
})

test("config declares only core: it decodes files and settles values, and knows no setting", () => {
  assert.deepEqual(deps(read("packages/config")), ["@pinetrie/core"])
})

test("only the app declares config: one table, declared in one place", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).includes("@pinetrie/config"),
  ).sort()
  assert.deepEqual(declaring, ["apps/pinetrie"])
})

test("keeper declares nothing", () => {
  assert.deepEqual(allDeps(read("packages/keeper")), [])
})

test("channel declares nothing: a lane's helper and lanehost both run it from pine·trie's install", () => {
  assert.deepEqual(allDeps(read("packages/channel")), [])
})

test("ssh declares nothing: a lane's hop runs it from pine·trie's install", () => {
  assert.deepEqual(allDeps(read("packages/ssh")), [])
})

test("only the app declares ssh: lanes and Docker know a host socket, never ssh", () => {
  const declaring = WORKSPACE.filter(dir =>
    allDeps(read(dir)).includes("@pinetrie/ssh"),
  ).sort()
  assert.deepEqual(declaring, ["apps/pinetrie"])
})

test("lanehost declares only core and channel: it knows nothing of lanes or Docker", () => {
  assert.deepEqual(deps(read("packages/lanehost")).sort(), [
    "@pinetrie/channel",
    "@pinetrie/core",
  ])
})

test("the page declares no server package and no app", () => {
  const web = deps(read("packages/web"))
  for (const forbidden of [
    "ws",
    "vite",
    "@pinetrie/app",
    "@pinetrie/pi",
    "@pinetrie/lanes",
    "@pinetrie/jj",
  ]) {
    assert.ok(
      !web.includes(forbidden),
      `the page must not depend on ${forbidden}`,
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
  "unbash",
]
