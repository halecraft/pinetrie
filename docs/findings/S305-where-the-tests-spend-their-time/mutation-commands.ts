import { spawnSync } from "node:child_process"
import { loadMutationLists, type CommandMutation } from "/workspace/scripts/mutate.ts"
const lists = await loadMutationLists("/workspace/scripts/mutations")
const by = new Map<string, CommandMutation[]>()
for (const l of lists) for (const m of l.mutations) {
  if ("suite" in m) continue
  const k = JSON.stringify(m.command); by.set(k, [...(by.get(k) ?? []), m])
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const time = (args: string[]) => { const s = performance.now(); const r = spawnSync(args[0], args.slice(1), { cwd: "/workspace", encoding: "utf8" }); return [Math.round(performance.now() - s), r.status] as const }
const top = [...by].sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.argv[2] ?? 25))
let whole = 0, narrow = 0
for (const [k, ms] of top) {
  const cmd = JSON.parse(k) as string[]
  const [w, ws] = time(cmd)
  const sample = ms.find(m => m.expect !== undefined)
  const isVitest = cmd.includes("vitest")
  const [n, ns] = sample && isVitest ? time([...cmd, "-t", esc(sample.expect!)]) : [w, ws]
  whole += w * ms.length; narrow += n * ms.length
  console.log(`${ms.length}\t${w}\t${ws}\t${n}\t${ns}\t${cmd.slice(3).join(" ")}`)
}
console.log(`est batch whole ${Math.round(whole/60000)} min, narrowed ${Math.round(narrow/60000)} min`)
