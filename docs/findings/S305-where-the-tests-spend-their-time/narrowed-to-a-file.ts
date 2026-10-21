import { spawnSync } from "node:child_process"
import { loadMutationLists, type CommandMutation } from "/workspace/scripts/mutate.ts"
const lists = await loadMutationLists("/workspace/scripts/mutations")
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const list = spawnSync("pnpm", ["exec", "vitest", "list", "--json"], { cwd: "/workspace", encoding: "utf8", maxBuffer: 1e9 })
const tests = JSON.parse(list.stdout.slice(list.stdout.indexOf("["))) as { name: string; file: string }[]
const time = (args: string[]) => { const s = performance.now(); const r = spawnSync(args[0], args.slice(1), { cwd: "/workspace", encoding: "utf8" }); return [Math.round(performance.now() - s), r.status, (r.stdout.match(/Tests\s+.*/)?.[0] ?? "").replace(/\x1b\[[0-9;]*m/g, "")] as const }
for (const dir of ["packages/interface", "apps/pinetrie/host", "packages/rules", "packages/pi"]) {
  const ms = lists.flatMap(l => l.mutations).filter((m): m is CommandMutation => !("suite" in m) && m.command.at(-1) === dir && m.expect !== undefined)
  for (const m of ms.slice(0, 3)) {
    const files = [...new Set(tests.filter(t => t.name.includes(m.expect!)).map(t => t.file))]
    console.log(dir, files.length, "file(s)", time(["pnpm", "exec", "vitest", "run", ...files, "-t", esc(m.expect!)]))
  }
}
console.log("tests listed", tests.length)
