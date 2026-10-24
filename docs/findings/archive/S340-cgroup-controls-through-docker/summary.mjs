// node summary.mjs <out dir> [from-seconds] [to-seconds]: per cgroup in the
// run's samples (named by `ids`, else its id), the rise of each counter over
// the window, and min / median / max of its gauges; the root's likewise.
// The window is in seconds from the first sample.
import fs from "node:fs"

const dir = process.argv[2]
const from = Number(process.argv[3] ?? 0)
const to = Number(process.argv[4] ?? Infinity)
const names = new Map()
if (fs.existsSync(`${dir}/ids`))
  for (const line of fs.readFileSync(`${dir}/ids`, "utf8").trim().split("\n")) {
    const [name, id] = line.split(" ")
    names.set(id, name)
  }
const rows = new Map()
let t0 = null
for (const line of fs.readFileSync(`${dir}/samples`, "utf8").split("\n")) {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== "root" && parts[0] !== "cg") continue
  const kv = Object.fromEntries(
    parts.slice(1).filter(p => p.includes("=")).map(p => {
      const i = p.indexOf("=")
      return [p.slice(0, i), p.slice(i + 1)]
    }),
  )
  const t = Number(kv.t)
  t0 ??= t
  if (t - t0 < from || t - t0 > to) continue
  const key = parts[0] === "root" ? "root" : (names.get(kv.id) ?? kv.id.slice(0, 12))
  if (!rows.has(key)) rows.set(key, [])
  rows.get(key).push(kv)
}
const COUNTERS = [
  "ev_low", "ev_high", "ev_max", "ev_oom_kill", "st_workingset_refault_file", "st_pgmajfault",
  "pids_ev_max", "cpu_usage_usec", "some_total", "full_total",
  "workingset_refault_file", "allocstall_normal", "allocstall_movable", "pgscan_direct", "pgscan_kswapd", "oom_kill",
]
const GAUGES = ["current", "st_file", "st_anon", "full_avg10", "some_avg10", "memavail", "pids"]
const mmm = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return `${s[0]} / ${s[Math.floor(s.length / 2)]} / ${s[s.length - 1]}`
}
const mb = (k, v) => (["current", "st_file", "st_anon"].includes(k) ? Math.round(v / 1048576) : k === "memavail" ? Math.round(v / 1024) : v)
for (const [key, list] of rows) {
  const out = [`${key} (${list.length} samples)`]
  for (const c of COUNTERS) {
    if (!(c in list[0])) continue
    out.push(`  ${c} rose ${Number(list.at(-1)[c]) - Number(list[0][c])}`)
  }
  for (const g of GAUGES) {
    if (!(g in list[0])) continue
    out.push(`  ${g}${["current", "st_file", "st_anon", "memavail"].includes(g) ? " (MiB)" : ""} ${mmm(list.map(r => mb(g, Number(r[g]))))}`)
  }
  for (const s of ["low", "high"]) if (s in list[0]) out.push(`  ${s} ${list[0][s]}`)
  console.log(out.join("\n"))
}
