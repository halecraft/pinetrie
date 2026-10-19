// S285's analysis of core's census (census.ts core > /tmp/core.json):
//   node docs/findings/S285-core-census-by-side/analyze.ts /tmp/core.json

import fs from "node:fs"

interface Exp {
  name: string
  module: string
  kind: "type" | "value"
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

const LANE = new Set(["lanes", "lanehost", "docker", "jj", "folder"])
const BELOW = new Set(["schema", "protocol", "config", "conformance"])
const sideOf = (u: string) => (LANE.has(u) ? "lane" : BELOW.has(u) ? "below" : "conv")
const CONVERSATION = ["cards.ts", "places.ts", "tree.ts", "intents.ts", "messages.ts", "mentions.ts"]

const line = (s = "") => console.log(s)

// 1. Exports no other package names.
const noSrc = c.exports.filter(e => e.src.length === 0)
const none = noSrc.filter(e => e.test.length === 0)
line(`exports: ${c.exports.length} (${c.exports.filter(e => e.kind === "type").length} types)`)
line(`named by no other package's source: ${noSrc.length}; of them named by no test either: ${none.length}`)
const byMod: Record<string, string[]> = {}
for (const e of noSrc) (byMod[e.module] ??= []).push(`${e.name}${e.inPkg.length ? "" : "°"}${e.test.length ? "ᵗ" : ""}`)
for (const [m, ns] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length))
  line(`  ${m} (${ns.length}): ${ns.join(" ")}`)
line("  (° named nowhere in core's source either; ᵗ named by another package's tests)")

// Per module: which sides name its exports (source).
line("\n== modules by the sides that name their exports (source; lane/below/conv counts of exports)")
const modSides: Record<string, { lane: Set<string>; below: Set<string>; conv: Set<string> }> = {}
for (const e of c.exports) {
  const m = (modSides[e.module] ??= { lane: new Set(), below: new Set(), conv: new Set() })
  for (const u of e.src) m[sideOf(u) as "lane" | "below" | "conv"].add(e.name)
}
for (const [m, s] of Object.entries(modSides).sort())
  line(
    `  ${m.padEnd(18)} lines ${String(c.modules[m]?.lines ?? 0).padStart(5)}  lane ${String(s.lane.size).padStart(3)}  below ${String(s.below.size).padStart(3)}  conv ${String(s.conv.size).padStart(3)}`,
  )

// 2. The lane side's modules, closed over core's own imports.
const laneModules = new Set(
  c.exports.filter(e => e.src.some(u => LANE.has(u)) || e.test.some(u => LANE.has(u))).map(e => e.module),
)
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
const lines = (ms: Iterable<string>) => [...ms].reduce((n, m) => n + (c.modules[m]?.lines ?? 0), 0)
const total = lines(Object.keys(c.modules))
line(`\n== lane side names exports of ${laneModules.size} modules: ${[...laneModules].sort().join(" ")}`)
for (const withTypes of [false, true]) {
  const cl = close(laneModules, withTypes)
  line(
    `closed over ${withTypes ? "value and type" : "value"} imports: ${cl.size} of ${Object.keys(c.modules).length} modules, ${lines(cl)} of ${total} lines; conversation modules taken in: ${CONVERSATION.filter(m => cl.has(m)).join(" ") || "none"}`,
  )
  line(`  added by closure: ${[...cl].filter(m => !laneModules.has(m)).sort().join(" ")}`)
}
// Below-rules packages too: the kernel every package below rules needs.
const belowModules = new Set(
  c.exports.filter(e => e.src.some(u => LANE.has(u) || BELOW.has(u))).map(e => e.module),
)
const clb = close(belowModules, true)
line(
  `\nbelow rules (lane side and schema, protocol, config), source only, closed over all imports: ${clb.size} modules, ${lines(clb)} lines; conversation modules taken in: ${CONVERSATION.filter(m => clb.has(m)).join(" ") || "none"}`,
)

// Which lane-side names sit in conversation modules, and why.
line("\n== names the lane side takes from conversation modules")
for (const e of c.exports)
  if (CONVERSATION.includes(e.module) && [...e.src, ...e.test].some(u => LANE.has(u) || BELOW.has(u)))
    line(`  ${e.module} ${e.name} (${e.kind}) <- ${[...e.src, ...e.test.map(t => `${t}ᵗ`)].filter(u => !["rules", "reads", "session", "interface", "web", "pi", "app"].includes(u.replace("ᵗ", ""))).join(",")}`)

// Edges between modules that bridge lane-side modules to conversation ones.
line("\n== imports from a lane-side module into a conversation module")
for (const m of laneModules) {
  const info = c.modules[m]
  if (info === undefined) continue
  for (const to of info.values) if (CONVERSATION.includes(to)) line(`  ${m} -> ${to} (value)`)
  for (const to of info.types) if (CONVERSATION.includes(to)) line(`  ${m} -> ${to} (type)`)
}

// 3. ERR, ErrCode, ValueWrite, Target.
line("\n== who names ERR, ErrCode, ValueWrite, Target")
for (const n of ["ERR", "ErrCode", "ValueWrite", "Target", "refused", "Refusal"]) {
  const e = c.exports.find(x => x.name === n)
  if (e === undefined) continue
  line(`  ${n} (${e.module}, ${e.kind}): src ${e.src.join(",")} | test ${e.test.join(",")} | core ${e.inPkg.join(",")}`)
}

// Per side, exports named by it alone.
line("\n== exports by the sides that name them (source)")
const combos: Record<string, number> = {}
for (const e of c.exports) {
  const k = [...new Set(e.src.map(sideOf))].sort().join("+") || "(none)"
  combos[k] = (combos[k] ?? 0) + 1
}
for (const [k, n] of Object.entries(combos).sort((a, b) => b[1] - a[1])) line(`  ${k}: ${n}`)
