// S287's probe: for each commit that edits core's, rules' or interface's
// index file, which of the package's modules its changed export lines name;
// and, for a thread's commit that started before others landed, whether a
// commit it raced edited the same module's block, or the block beside it.
//
//   node docs/findings/S287-index-churn-by-feature/probe.ts

import { execFileSync } from "node:child_process"

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: process.cwd(), maxBuffer: 1 << 28 }).toString()
const gitOr = (fallback: string, ...args: string[]) => {
  try {
    return git(...args)
  } catch {
    return fallback
  }
}

/** Each line's module: the `from "./m.ts"` that closes the statement it is in. */
function blocks(text: string): (string | null)[] {
  const lines = text.split("\n")
  const out: (string | null)[] = new Array(lines.length).fill(null)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ""
    if (start < 0 && /^export\b/.test(l)) start = i
    const m = l.match(/from "\.\/([^"]+)\.tsx?"/)
    if (start >= 0 && m !== null) {
      for (let j = start; j <= i; j++) out[j] = m[1] ?? null
      start = -1
    }
  }
  return out
}
/** The module order of a version of the file, to tell a neighbour. */
const order = (b: (string | null)[]) => [...new Set(b.filter((x): x is string => x !== null))]

interface Edit {
  commit: string
  parent: string
  start: string | null
  modules: Set<string>
  order: string[]
}

function edits(file: string): Edit[] {
  const commits = git("log", "--format=%H", "--reverse", "--", file).split("\n").filter(Boolean)
  const out: Edit[] = []
  for (const c of commits) {
    const parent = gitOr("", "rev-parse", `${c}^`).trim()
    if (parent === "") continue
    const before = blocks(gitOr("", "show", `${parent}:${file}`))
    const afterText = gitOr("", "show", `${c}:${file}`)
    const after = blocks(afterText)
    const modules = new Set<string>()
    const diff = git("diff", "-U0", parent, c, "--", file)
    for (const h of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const [os, ol, ns, nl] = [h[1], h[2] ?? "1", h[3], h[4] ?? "1"].map(Number) as [
        number,
        number,
        number,
        number,
      ]
      for (let i = 0; i < ol; i++) {
        const m = before[os - 1 + i]
        if (m) modules.add(m)
      }
      for (let i = 0; i < nl; i++) {
        const m = after[ns - 1 + i]
        if (m) modules.add(m)
      }
    }
    const start = git("log", "-1", "--format=%(trailers:key=Pinetrie-Start,valueonly)", c).trim() || null
    out.push({ commit: c, parent, start, modules, order: order(after) })
  }
  return out
}

const isAncestor = (a: string, b: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b])
    return true
  } catch {
    return false
  }
}

for (const file of ["packages/core/index.ts", "packages/rules/index.ts", "packages/interface/index.ts"]) {
  const es = edits(file)
  const hist: Record<number, number> = {}
  for (const e of es) hist[e.modules.size] = (hist[e.modules.size] ?? 0) + 1
  const since = git("log", "-1", "--reverse", "--format=%ad", "--date=short", "--", file).trim()
  console.log(`\n== ${file}: ${es.length} edits (first ${git("log", "--reverse", "--format=%ad", "--date=short", "--", file).split("\n")[0]})`)
  console.log(`  modules named per edit: ${JSON.stringify(hist)}`)
  void since

  // Races: a thread's commit whose start precedes earlier edits of this file.
  let raced = 0
  let sameBlock = 0
  let besideBlock = 0
  let apart = 0
  const examples: string[] = []
  for (let i = 0; i < es.length; i++) {
    const b = es[i] as Edit
    if (b.start === null || b.start === b.parent) continue
    if (gitOr("", "cat-file", "-t", b.start).trim() !== "commit") continue
    // Earlier edits of the file that landed after b's start.
    const rivals = es.slice(0, i).filter(a => !isAncestor(a.commit, b.start as string))
    if (rivals.length === 0) continue
    raced++
    let worst: "same" | "beside" | "apart" = "apart"
    for (const a of rivals) {
      for (const m of b.modules) {
        if (a.modules.has(m)) worst = "same"
        else if (worst !== "same") {
          const k = b.order.indexOf(m)
          const near = [b.order[k - 1], b.order[k + 1]]
          if (near.some(n => n !== undefined && a.modules.has(n))) worst = "beside"
        }
      }
    }
    if (worst === "same") sameBlock++
    else if (worst === "beside") besideBlock++
    else apart++
    if (worst !== "apart" && examples.length < 4)
      examples.push(`${b.commit.slice(0, 8)} raced ${rivals.length}: ${[...b.modules].join(",")}`)
  }
  console.log(
    `  edits that raced an earlier landing of this file: ${raced}; same module's block: ${sameBlock}; the block beside it: ${besideBlock}; apart: ${apart}`,
  )
  for (const x of examples) console.log(`    e.g. ${x}`)
}
