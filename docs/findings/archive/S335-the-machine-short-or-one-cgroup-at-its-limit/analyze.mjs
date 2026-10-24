// The readings of one run (out/<load>/samples), per 5 s sample: the root's
// PSI and available share, vmstat's rises, each container's own stall and
// memory.events max rise, and each candidate reading over or not.
// Writes out/<load>/table.tsv; prints a summary over the load's window.
//   node analyze.mjs <load>
import { readFileSync, writeFileSync } from "node:fs"

const load = process.argv[2]
const dir = new URL(`out/${load}/`, import.meta.url)
const read = f => readFileSync(new URL(f, dir), "utf8")
const fields = line =>
  Object.fromEntries(
    line.split(/\s+/).filter(w => w.includes("=")).map(w => {
      const [k, v] = w.split("=")
      return [k, k === "id" ? v : Number(v)]
    }),
  )
const names = new Map(read("ids").trim().split("\n").filter(Boolean).map(l => l.split(" ").reverse()))
const marks = Object.fromEntries(read("marks").trim().split("\n").map(l => l.split(" ")).map(([k, v]) => [k, Number(v)]))
const samples = new Map()
for (const line of read("samples").split("\n")) {
  const kind = line.split(" ")[0]
  if (kind !== "root" && kind !== "cg") continue
  const f = fields(line)
  const s = samples.get(f.t) ?? { t: f.t, cg: new Map() }
  samples.set(f.t, s)
  if (kind === "root") s.root = f
  else if (names.has(f.id)) s.cg.set(names.get(f.id), f)
}
const list = [...samples.values()].filter(s => s.root).sort((a, b) => a.t - b.t)
const rows = []
for (let i = 1; i < list.length; i++) {
  const [p, s] = [list[i - 1], list[i]]
  const dt = (s.t - p.t) * 1e6
  const d = k => s.root[k] - p.root[k]
  const share = s.root.memavail / s.root.memtotal
  let atMaxFull = 0, atMaxSome = 0
  const cgs = []
  for (const [name, c] of s.cg) {
    const q = p.cg.get(name)
    if (q === undefined) continue
    const maxRise = c.ev_max - q.ev_max
    const fullPct = (100 * (c.full_total - q.full_total)) / dt
    if (maxRise > 0) {
      atMaxFull += c.full_total - q.full_total
      atMaxSome += c.some_total - q.some_total
    }
    cgs.push({ name, full10: c.full_avg10, fullPct, maxRise, oomKill: c.ev_oom_kill })
  }
  const r = {
    t: s.t - marks.start,
    inLoad: s.t > marks.start && s.t <= marks.end,
    full10: s.root.full_avg10,
    some10: s.root.some_avg10,
    fullPct: (100 * d("full_total")) / dt,
    share,
    allocstall: d("allocstall_normal") + d("allocstall_movable"),
    pgscanDirect: d("pgscan_direct"),
    pgscanKswapd: d("pgscan_kswapd"),
    refaultFile: d("workingset_refault_file"),
    residualFullPct: Math.max(0, (100 * (d("full_total") - atMaxFull)) / dt),
    residualSomePct: Math.max(0, (100 * (d("some_total") - atMaxSome)) / dt),
    atMax: cgs.filter(c => c.maxRise > 0).map(c => c.name),
    cgs,
  }
  r.rung3Or = r.full10 > 10 || share < 0.05
  r.rung2Or = r.full10 > 5 || share < 0.1
  r.rung3And = r.full10 > 10 && share < 0.1
  r.rung2And = r.full10 > 5 && share < 0.15
  r.globalReclaim = r.allocstall + r.pgscanDirect > 0
  r.kswapd = r.pgscanKswapd > 0
  r.residual10 = r.residualFullPct > 10
  r.residual5 = r.residualFullPct > 5
  rows.push(r)
}
const pct = x => x.toFixed(1)
writeFileSync(
  new URL("table.tsv", dir),
  [
    "t\tin_load\tfull_avg10\tsome_avg10\tfull_pct\tavail_share\tallocstall\tpgscan_direct\tpgscan_kswapd\trefault_file\tresidual_full_pct\tat_max\tcontainers(name full_avg10 full_pct max_rise oom_kill)",
    ...rows.map(r =>
      [r.t, r.inLoad ? 1 : 0, r.full10, r.some10, pct(r.fullPct), r.share.toFixed(3), r.allocstall, r.pgscanDirect, r.pgscanKswapd, r.refaultFile, pct(r.residualFullPct), r.atMax.join(",") || "-",
        r.cgs.map(c => `${c.name} ${c.full10} ${pct(c.fullPct)} ${c.maxRise} ${c.oomKill}`).join("; ")].join("\t"),
    ),
  ].join("\n") + "\n",
)
const window = rows.filter(r => r.inLoad && r.t > 60)
const stat = (k, f = x => x) => {
  const v = window.map(r => f(r[k])).sort((a, b) => a - b)
  return `${v[0]} / ${v[Math.floor(v.length / 2)]} / ${v.at(-1)}`
}
const share = k => `${window.filter(r => r[k]).length}/${window.length}`
console.log(`load ${load}: ${window.length} samples from 60 s into the load to its end (min / median / max)`)
for (const k of ["full10", "some10", "allocstall", "pgscanDirect", "pgscanKswapd", "refaultFile"]) console.log(`  ${k}: ${stat(k)}`)
console.log(`  share: ${stat("share", x => +x.toFixed(3))}`)
console.log(`  residualFullPct: ${stat("residualFullPct", x => +x.toFixed(1))}`)
for (const k of ["rung3Or", "rung2Or", "rung3And", "rung2And", "globalReclaim", "kswapd", "residual10", "residual5"]) console.log(`  ${k} over: ${share(k)}`)
const byName = new Map()
for (const r of window) for (const c of r.cgs) (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)).push(c)
for (const [name, cs] of byName) {
  const f = cs.map(c => c.full10).sort((a, b) => a - b)
  console.log(`  ${name}: own full avg10 ${f[0]} / ${f[Math.floor(f.length / 2)]} / ${f.at(-1)}, max rose in ${cs.filter(c => c.maxRise > 0).length}/${cs.length}, oom_kill ${Math.max(...cs.map(c => c.oomKill))}`)
}
