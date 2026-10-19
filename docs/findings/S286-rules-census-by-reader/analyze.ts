// S286's analysis of rules' census (S285's census.ts rules > /tmp/rules.json):
//   node docs/findings/S286-rules-census-by-reader/analyze.ts /tmp/rules.json

import fs from "node:fs"

interface Exp {
  name: string
  module: string
  kind: "type" | "value"
  entries: string[]
  src: string[]
  test: string[]
  srcFiles: string[]
  inPkg: string[]
}
interface Census {
  exports: Exp[]
  modules: Record<string, { lines: number; values: string[]; types: string[] }>
}
const file = process.argv[2]
if (file === undefined) throw new Error("name the census's JSON")
const c: Census = JSON.parse(fs.readFileSync(file, "utf8"))
const line = (s = "") => console.log(s)

const PAGE = new Set(["reads", "session", "interface", "web"])
type Group = "shared" | "host-pi" | "host" | "none"
const groupOfUsers = (users: string[]): Group =>
  users.some(u => PAGE.has(u))
    ? "shared"
    : users.includes("pi")
      ? "host-pi"
      : users.length > 0
        ? "host"
        : "none"

const mods = Object.keys(c.modules).filter(m => m !== "index.ts" && m !== "fixtures.ts")
const L = (ms: Iterable<string>) => [...ms].reduce((n, m) => n + (c.modules[m]?.lines ?? 0), 0)
const total = L(mods)

// Each module's group, by the union of its exports' source users outside rules.
const usersOf: Record<string, Set<string>> = {}
for (const e of c.exports) {
  const s = (usersOf[e.module] ??= new Set())
  for (const u of e.src) s.add(u)
}
const groupOf: Record<string, Group> = {}
for (const m of mods) groupOf[m] = groupOfUsers([...(usersOf[m] ?? [])])

line(`modules ${mods.length}, lines ${total}, exports ${c.exports.length}`)
line("\n== groups by who outside rules names a module's exports (source)")
for (const g of ["shared", "host-pi", "host", "none"] as const) {
  const ms = mods.filter(m => groupOf[m] === g)
  const ex = c.exports.filter(e => groupOf[e.module] === g)
  line(`  ${g.padEnd(8)} modules ${String(ms.length).padStart(3)}  lines ${String(L(ms)).padStart(6)}  exports ${String(ex.length).padStart(4)}`)
  line(`    ${ms.sort().join(" ")}`)
}

// Closure of the shared group under rules' own imports.
const close = (start: Set<string>, withTypes: boolean) => {
  const seen = new Set(start)
  const stack = [...start]
  while (stack.length) {
    const m = stack.pop() as string
    const info = c.modules[m]
    if (info === undefined) continue
    for (const to of [...info.values, ...(withTypes ? info.types : [])])
      if (!seen.has(to)) {
        seen.add(to)
        stack.push(to)
      }
  }
  return seen
}
const shared = new Set(mods.filter(m => groupOf[m] === "shared"))
for (const withTypes of [false, true]) {
  const cl = close(shared, withTypes)
  const added = [...cl].filter(m => !shared.has(m))
  line(
    `\nshared closed over ${withTypes ? "value and type" : "value"} imports: ${cl.size} modules, ${L(cl)} of ${total} lines (${Math.round((100 * L(cl)) / total)}%)`,
  )
  line(`  host or host-pi modules taken in (${added.length}, ${L(added)} lines): ${added.sort().map(m => `${m}[${groupOf[m]}]`).join(" ")}`)
}

// Which imports pull a host module into the shared closure: edges from a
// module in the shared closure to a host/host-pi module.
line("\n== edges from the shared side into host or host-pi modules (value imports)")
const clv = close(shared, false)
for (const m of clv) {
  const info = c.modules[m]
  if (info === undefined) continue
  for (const to of info.values)
    if (groupOf[to] === "host" || groupOf[to] === "host-pi") line(`  ${m}[${groupOf[m]}] -> ${to}[${groupOf[to]}]`)
}

// Mixed modules: some exports shared, some host only.
line("\n== shared modules with exports only the host (or host and pi) names, or none outside")
for (const m of [...shared].sort()) {
  const ex = c.exports.filter(e => e.module === m)
  const byG: Record<Group, string[]> = { shared: [], "host-pi": [], host: [], none: [] }
  for (const e of ex) byG[groupOfUsers(e.src)].push(e.name)
  line(
    `  ${m.padEnd(20)} shared ${String(byG.shared.length).padStart(3)}  host-pi ${String(byG["host-pi"].length).padStart(3)}  host ${String(byG.host.length).padStart(3)}  none ${String(byG.none.length).padStart(3)}`,
  )
}

// Exports by group, and how many the app names that nothing else does.
line("\n== exports by who names them (source)")
const counts: Record<string, number> = {}
for (const e of c.exports) {
  const k = e.src.join(",") || "(none)"
  counts[k] = (counts[k] ?? 0) + 1
}
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25)) line(`  ${String(n).padStart(4)} ${k}`)
const unnamed = c.exports.filter(e => e.src.length === 0 && !e.entries.includes("./fixtures"))
line(`\nexports no other package's source names: ${unnamed.length}; nor any test: ${unnamed.filter(e => e.test.length === 0).length}`)

// The host's own use: how many host files name rules, how many names.
const appNames = c.exports.filter(e => e.src.includes("app"))
const appFiles = new Set(appNames.flatMap(e => e.srcFiles.filter(f => f.startsWith("apps/pinetrie"))))
line(`app names ${appNames.length} exports of rules, from ${appFiles.size} files`)
