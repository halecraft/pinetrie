// The trial build: from the entries, follow every import, strip each
// .ts file's types with Node's own stripper, rewrite each import of a .ts
// file (relative or @pinetrie/*) to its .js, keep the repo's layout, and
// write a package.json for `pinetrie`. Run from the repo's root:
//   node docs/findings/S257-a-build-node-runs-from-node-modules/build.mjs <out>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import path from "node:path"
import { parseSync } from "oxc-parser"

const root = process.cwd()
const out = path.resolve(process.argv[2] ?? "dist-trial")
const t0 = performance.now()

const ENTRIES = [
  "apps/pinetrie/host/serve.ts",
  "apps/pinetrie/scripts/sign-in.ts",
  "apps/pinetrie/scripts/tidy.ts",
  "apps/pinetrie/scripts/session.ts",
  // Run by a path in a string, not imported.
  "packages/pi/lane-helper.ts",
  "packages/ssh/hop.ts",
  "packages/lanehost/observer-server.ts",
  "packages/lanehost/observer-connect.ts",
  "packages/lanehost/tar-out.ts",
  "packages/lanehost/file-out.ts",
  "packages/lanehost/server.ts",
  "packages/lanehost/once.ts",
]

// Workspace packages: name -> { dir, exports, deps }.
const workspace = new Map()
for (const base of ["packages", "apps"])
  for (const d of readdirSync(path.join(root, base))) {
    const pj = path.join(root, base, d, "package.json")
    if (!existsSync(pj)) continue
    const m = JSON.parse(readFileSync(pj, "utf8"))
    workspace.set(m.name, { dir: path.join(base, d), exports: m.exports ?? {}, deps: m.dependencies ?? {} })
  }

const resolveWorkspace = spec => {
  const [scope, name, ...rest] = spec.split("/")
  const pkg = workspace.get(`${scope}/${name}`)
  if (pkg === undefined) throw new Error(`no workspace package for ${spec}`)
  const key = rest.length === 0 ? "." : `./${rest.join("/")}`
  const target = typeof pkg.exports === "string" && key === "." ? pkg.exports : pkg.exports[key]
  if (typeof target !== "string") throw new Error(`${spec}: no export ${key}`)
  return path.join(pkg.dir, target)
}

const packageName = spec =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]

const thirdParty = new Map() // name -> [files]
const seen = new Set()
const queue = [...ENTRIES]
const notes = []
const files = []

while (queue.length > 0) {
  const rel = queue.shift()
  if (seen.has(rel)) continue
  seen.add(rel)
  const src = readFileSync(path.join(root, rel), "utf8")
  let code
  try {
    code = stripTypeScriptTypes(src, { mode: "strip" })
  } catch (e) {
    notes.push(`strip refused ${rel}: ${e.message}`)
    continue
  }
  const parsed = parseSync(rel, src)
  const requests = [
    ...parsed.module.staticImports.map(i => i.moduleRequest),
    ...parsed.module.staticExports.flatMap(e => e.entries.map(x => x.moduleRequest)).filter(Boolean),
    ...parsed.module.dynamicImports.map(d => d.moduleRequest),
  ]
  const edits = []
  const at = new Set()
  for (const r of requests) {
    if (at.has(r.start)) continue
    at.add(r.start)
    const literal = src.slice(r.start, r.end)
    if (!/^["']/.test(literal)) {
      notes.push(`computed import in ${rel}: ${literal}`)
      continue
    }
    // A type-only import is gone from the stripped code: nothing loads it.
    if (code.slice(r.start, r.end) !== literal) continue
    const spec = literal.slice(1, -1)
    let target = null
    if (spec.startsWith(".")) target = path.join(path.dirname(rel), spec)
    else if (spec.startsWith("@pinetrie/")) target = resolveWorkspace(spec)
    else if (spec.startsWith("node:")) continue
    else {
      const name = packageName(spec)
      thirdParty.set(name, [...(thirdParty.get(name) ?? []), rel])
      continue
    }
    if (target.endsWith(".ts")) queue.push(target)
    else if (!target.endsWith(".json")) notes.push(`non-ts import ${rel} -> ${target}`)
    const js = target.replace(/\.ts$/, ".js")
    let to = path.relative(path.dirname(rel), js)
    if (!to.startsWith(".")) to = `./${to}`
    edits.push({ start: r.start, end: r.end, text: JSON.stringify(to) })
  }
  edits.sort((a, b) => b.start - a.start)
  for (const e of edits) code = code.slice(0, e.start) + e.text + code.slice(e.end)
  files.push({ rel, code })
}

rmSync(out, { recursive: true, force: true })
for (const { rel, code } of files) {
  const dest = path.join(out, rel.replace(/\.ts$/, ".js"))
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, code)
}

// Assets: every other file of a package that holds a built file, but tests,
// fixtures, notes for contributors and manifests.
const SKIP_DIRS = new Set(["node_modules", "fixtures", "testdata", "testing", "e2e", "dist", "src"])
const isAsset = name =>
  !name.endsWith(".ts") && !name.endsWith(".tsx") && name !== "TECHNICAL.md" && name !== "tsconfig.json" && name !== "package.json"
const assets = []
const walk = dir => {
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(rel)
    } else if (isAsset(e.name)) assets.push(rel)
  }
}
const builtDirs = new Set([...seen].map(f => f.split("/").slice(0, 2).join("/")))
for (const d of builtDirs) walk(d)
for (const a of assets) cpSync(path.join(root, a), path.join(out, a))
cpSync(path.join(root, "packages/web/dist"), path.join(out, "packages/web/dist"), { recursive: true })
writeFileSync(path.join(out, "packages/web/package.json"), JSON.stringify({ name: "@pinetrie/web", private: true }))

// Dependencies: each third-party package imported, at the version the
// workspace package that imports it declares.
const declared = new Map()
for (const { deps } of workspace.values())
  for (const [n, v] of Object.entries(deps)) if (!v.startsWith("workspace:")) declared.set(n, v)
const dependencies = {}
for (const n of [...thirdParty.keys()].sort()) {
  const v = declared.get(n)
  if (v === undefined) notes.push(`undeclared third-party import ${n} (${thirdParty.get(n)[0]})`)
  else dependencies[n] = v
}
// A peer @kyneta/sqlite-store needs, which the app declares to meet it.
dependencies["@kyneta/sql-store-core"] = declared.get("@kyneta/sql-store-core")

writeFileSync(
  path.join(out, "package.json"),
  `${JSON.stringify(
    {
      name: "pinetrie",
      version: "0.0.0-trial",
      type: "module",
      engines: { node: ">=24" },
      bin: { "pinetrie-serve": "apps/pinetrie/host/serve.js" },
      dependencies,
    },
    null,
    2,
  )}\n`,
)

const ms = Math.round(performance.now() - t0)
console.log(JSON.stringify({ ms, built: files.length, assets: assets.length, dependencies, notes }, null, 2))
