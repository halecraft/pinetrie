// node phases.mjs <out dir>: the memory.low run's samples while the lanes ran
// (from `marks`), split by the VM's MemAvailable: over 600 MiB (the machine
// short, but with unprotected pages left to reclaim) and under (the lanes'
// anonymous memory alone filling it). Per service: samples, median
// memory.current, file refaults and memory.events `low` per sample (median),
// and its own memory `full avg10` (median).
import fs from "node:fs"

const dir = process.argv[2]
const ids = new Map(fs.readFileSync(`${dir}/ids`, "utf8").trim().split("\n").map(l => l.split(" ").reverse()))
const marks = Object.fromEntries(fs.readFileSync(`${dir}/marks`, "utf8").trim().split("\n").map(l => l.split(" ")))
const parse = line => Object.fromEntries(line.trim().split(/\s+/).slice(1).filter(p => p.includes("=")).map(p => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]))
const byTime = new Map()
for (const line of fs.readFileSync(`${dir}/samples`, "utf8").split("\n")) {
  if (!/^(root|cg) /.test(line)) continue
  const kv = parse(line)
  if (!byTime.has(kv.t)) byTime.set(kv.t, { cg: new Map() })
  const s = byTime.get(kv.t)
  if (line.startsWith("root")) s.root = kv
  else s.cg.set(ids.get(kv.id) ?? (kv.id === "pinetrie-services" ? "services parent" : kv.id), kv)
}
const times = [...byTime.keys()].sort()
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const rows = {}
for (let i = 1; i < times.length; i++) {
  const t = Number(times[i])
  if (t < Number(marks.lanes) + 10 || t > Number(marks["lanes-end"])) continue
  const now = byTime.get(times[i]), before = byTime.get(times[i - 1])
  const phase = Number(now.root.memavail) / 1024 > 600 ? "room" : "full"
  for (const [name, kv] of now.cg) {
    if (!name.startsWith("svc") && name !== "services parent") continue
    const prev = before.cg.get(name)
    if (!prev) continue
    const key = `${name}|${phase}`
    rows[key] ??= { n: 0, cur: [], ref: [], low: [], full: [] }
    const r = rows[key]
    r.n++
    r.cur.push(Number(kv.current) / 1048576)
    r.ref.push(Number(kv.st_workingset_refault_file) - Number(prev.st_workingset_refault_file))
    r.low.push(Number(kv.ev_low) - Number(prev.ev_low))
    r.full.push(Number(kv.full_avg10))
  }
}
console.log("service\tphase\tsamples\tcurrent MiB\trefaults/sample\tlow events/sample\tfull avg10")
for (const [key, r] of Object.entries(rows).sort()) {
  const [name, phase] = key.split("|")
  console.log([name, phase, r.n, Math.round(median(r.cur)), median(r.ref), median(r.low), median(r.full)].join("\t"))
}
