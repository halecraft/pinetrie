import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
const { mutations } = await import("/workspace/scripts/mutations/jj.ts")
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const files = new Set(["packages/jj/lane-read.ts", "packages/jj/proposed.ts", "packages/jj/shared.ts", "packages/jj/get-latest.ts", "packages/jj/proposed-gather.ts", "packages/jj/accepted.ts", "packages/core/trailers.ts"])
const repoTitles = readFileSync("/workspace/packages/jj/repo.test.ts", "utf8")
const chosen = mutations.filter((m: any) => !("suite" in m) && files.has(m.file) && m.expect && repoTitles.includes(m.expect.slice(0, 40)))
const out: string[] = []
for (const m of chosen) {
  const f = `/workspace/${m.file}`, orig = readFileSync(f, "utf8")
  if (orig.split(m.from).length !== 2) { out.push(`ANCHOR  ${m.name}`); continue }
  writeFileSync(f, orig.replace(m.from, m.to))
  try {
    const r = spawnSync("pnpm", ["exec", "vitest", "run", "packages/jj/repo.test.ts", "-t", esc(m.expect)], { cwd: "/workspace", encoding: "utf8" })
    const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "")
    const ran = /Tests\s+(.*)/.exec(txt)?.[1] ?? "?"
    out.push(`${r.status === 0 ? "SURVIVED" : "KILLED  "} ${m.name.slice(0, 90)}  [${ran}]`)
  } finally { writeFileSync(f, orig) }
}
console.log(out.join("\n"))
