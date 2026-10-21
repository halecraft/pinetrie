import { readFileSync } from "node:fs"
import { loadMutationLists, type SuiteMutation } from "/workspace/scripts/mutate.ts"
const lists = await loadMutationLists("/workspace/scripts/mutations")
const logs: Record<string, string> = { host: "e2e-host.log", lanes: "e2e-lanes.log", browser: "e2e-browser.log" }
const at = new Map<string, Map<string, number>>() // suite -> "scenario\0label" -> seconds into scenario
const len = new Map<string, number>()
for (const [suite, f] of Object.entries(logs)) {
  const m = new Map<string, number>(); at.set(suite, m)
  let scen = "", t0 = 0, last = 0
  for (const line of readFileSync(`sandbox/test-timing/${f}`, "utf8").split("\n")) {
    const t = Number(line.slice(0, 7)); const rest = line.slice(8)
    const s = /^── (\S+)/.exec(rest)
    if (s) { if (scen) len.set(`${suite}/${scen}`, last - t0); scen = s[1]; t0 = t; continue }
    if (!Number.isNaN(t)) last = t
    const c = /^\s+(PASS|FAIL)\s+(.*?)(?: · .*)?$/.exec(rest)
    if (c) m.set(`${scen}\0${c[2]}`, t - t0)
  }
  if (scen) len.set(`${suite}/${scen}`, last - t0)
}
const tot: Record<string, [number, number, number]> = {}
for (const m of lists.flatMap(l => l.mutations).filter((m): m is SuiteMutation => "suite" in m)) {
  const s = at.get(m.suite)?.get(`${m.scenario}\0${m.expect}`)
  const e = tot[m.suite] ??= [0, 0, 0]
  if (s === undefined) { e[2]++; continue }
  e[0] += s + 3; e[1]++  // +3 s for the runner's own start
}
for (const [s, [sec, n, miss]] of Object.entries(tot)) console.log(`${s}: ${n} mutants timed, ~${Math.round(sec / 60)} min (+${miss} not found in the log)`)
console.log([...len].map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(", "))
