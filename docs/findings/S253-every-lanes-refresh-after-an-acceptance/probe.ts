// S253's probe: every lane's refresh gather, as the host runs it after accepted
// work moves (each lane's `known` catch-up read none), on a copy of your repo,
// then the same facts by other ways. Run: node probe.ts <repo> [ways...]
// Ways: serial (always), parallel, memo, onelog, git.

import { spawn } from "node:child_process"
import type { Ran, Runner } from "../../../packages/lanes/run.ts"
import { DEFAULT_REPO, laneTipName } from "../../../packages/jj/lane/names.ts"
import { gatherRefresh } from "../../../packages/jj/proposed-gather.ts"
import type { RepoOps } from "../../../packages/jj/owner.ts"
import { runnerFor } from "../../../packages/jj/run.ts"
import { readShared } from "../../../packages/jj/shared.ts"

const root = process.argv[2] ?? "/tmp/s253/repo"
const ways = new Set(process.argv.slice(3))
const repoConfig = DEFAULT_REPO

interface Call {
  readonly args: readonly string[]
  readonly ms: number
}

const host = runnerFor(root, "host")
const head = await host(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
if (!head.ok) throw new Error(head.stderr)
const op = head.stdout.trim()
const calls: Call[] = []
const pinned = runnerFor(root, { at: op }, c => calls.push(c))
const git = runnerFor(root, "git", c => calls.push(c))

// Every lane in your repo: a `tip@pinetrie-<lane>` remote bookmark.
const listed = await pinned([
  "bookmark",
  "list",
  "--all-remotes",
  "-T",
  'if(remote, name ++ "@" ++ remote ++ "\\n")',
])
const lanes = listed.stdout
  .split("\n")
  .filter(l => l.startsWith("tip@pinetrie-") && l !== "tip@pinetrie-host")
  .map(l => l.slice("tip@pinetrie-".length))

// Names from proposed bookmarks, by the `Pinetrie-Lane` trailer of their commit.
const proposed = await pinned([
  "log",
  "--no-graph",
  "-r",
  'bookmarks(glob:"pinetrie-proposed/*")',
  "-T",
  'local_bookmarks.map(|b| b.name()).join(",") ++ "\\t" ++ json(description) ++ "\\n"',
])
const names = new Map<string, string>()
for (const row of proposed.stdout.split("\n").filter(Boolean)) {
  const [bookmarks = "", ...rest] = row.split("\t")
  const description = JSON.parse(rest.join("\t")) as string
  const lane = /Pinetrie-Lane: (\S+)/.exec(description)?.[1]
  const name = bookmarks
    .split(",")
    .find(b => b.startsWith("pinetrie-proposed/"))
  if (lane !== undefined && name !== undefined)
    names.set(lane, name.slice("pinetrie-proposed/".length))
}

calls.length = 0
const sharedAt = performance.now()
const shared = await readShared(op, pinned, git, repoConfig)
const sharedMs = performance.now() - sharedAt
const sharedCalls = calls.splice(0)

/** One lane's gather with `jj` as its runner, its calls and wall time. */
async function gather(lane: string, jj: Runner) {
  const mine: Call[] = []
  const timed: Runner = async args => {
    const at = performance.now()
    const ran = await jj(args)
    mine.push({ args, ms: performance.now() - at })
    return ran
  }
  const ops = {
    jj: timed,
    jjAsYou: () => Promise.reject(new Error("no writes in a probe")),
    git,
    execute: () => Promise.reject(new Error("no writes in a probe")),
    shared: async () => shared,
  } as unknown as RepoOps
  const at = performance.now()
  const result = await gatherRefresh(ops, {
    lane: lane as never,
    // A lane with no proposed changes: a name no bookmark has.
    name: (names.get(lane) ?? `s253-none-${lane}`) as never,
    repoConfig,
    known: null,
    archived: false,
  })
  return {
    lane,
    result: JSON.stringify(result),
    calls: mine,
    wall: performance.now() - at,
  }
}

type Gathered = Awaited<ReturnType<typeof gather>>
const verb = (c: Call) =>
  c.args[0] === "diff"
    ? c.args.includes("--name-only")
      ? "diff --name-only"
      : "diff -T"
    : (c.args[0] ?? "")

function report(way: string, wall: number, all: Gathered[], base?: Gathered[]) {
  const processes = all.reduce((n, g) => n + g.calls.length, 0)
  const differ =
    base === undefined
      ? []
      : all.filter((g, i) => g.result !== base[i]?.result).map(g => g.lane)
  console.log(
    `\n## ${way}: ${all.length} lanes, ${processes} jj calls, wall ${wall.toFixed(0)} ms` +
      (base === undefined ? "" : `, lanes whose facts differ: ${differ.length}`),
  )
  if (differ.length > 0) console.log(`  differ: ${differ.join(" ")}`)
}

console.log(`# jj ${(await pinned(["--version"])).stdout.trim()}, op ${op.slice(0, 12)}`)
console.log(`lanes: ${lanes.length}, named by proposed changes: ${names.size}`)
console.log(
  `shared facts: ${sharedCalls.length} calls, ${sharedMs.toFixed(0)} ms (${sharedCalls.map(c => `${c.args[0]} ${c.ms.toFixed(0)}`).join(", ")})`,
)

// A floor: one jj process that loads the repo and prints nothing.
const floor: number[] = []
for (let i = 0; i < 10; i++) {
  const at = performance.now()
  await pinned(["log", "--no-graph", "-r", "root()", "-T", '""'])
  floor.push(performance.now() - at)
}
floor.sort((a, b) => a - b)
console.log(`one empty jj log: median ${floor[5]?.toFixed(1)} ms`)

// serial, as the owner runs them
let at = performance.now()
const serial: Gathered[] = []
for (const lane of lanes) serial.push(await gather(lane, pinned))
report("serial", performance.now() - at, serial)
for (const g of serial.slice(2, 3).concat(serial.filter(g => names.has(g.lane)).slice(0, 1)))
  for (const c of g.calls)
    console.log(
      `  [${g.lane.slice(0, 13)}] ${c.ms.toFixed(0)} ms, ${c.args.join(" ").length} chars: ${c.args.join(" ").slice(0, 140)}`,
    )
if (ways.has("dump")) {
  const { writeFile } = await import("node:fs/promises")
  await writeFile("/tmp/s253/reads.json", JSON.stringify({ plain: serial[2]?.calls.map(c => c.args), proposed: serial[0]?.calls.map(c => c.args) }))
  process.exit(0)
}
const byVerb = new Map<string, { n: number; ms: number }>()
for (const c of serial.flatMap(g => g.calls)) {
  const v = byVerb.get(verb(c)) ?? { n: 0, ms: 0 }
  byVerb.set(verb(c), { n: v.n + 1, ms: v.ms + c.ms })
}
for (const [v, { n, ms }] of byVerb)
  console.log(`  ${v}: ${n} calls, ${ms.toFixed(0)} ms, mean ${(ms / n).toFixed(1)}`)
for (const g of serial)
  console.log(
    `  ${g.lane} ${names.has(g.lane) ? "proposed" : "-"} ${g.calls.length} calls ${g.wall.toFixed(0)} ms ${JSON.parse(g.result).kind}/${JSON.parse(g.result).facts?.kind ?? ""}`,
  )

/** Run `go` over every lane, `width` at a time, in lane order. */
async function pool<T>(width: number, go: (lane: string) => Promise<T>) {
  const out: T[] = new Array(lanes.length)
  let next = 0
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < lanes.length) {
        const i = next++
        out[i] = await go(lanes[i] as string)
      }
    }),
  )
  return out
}

if (ways.has("parallel"))
  for (const width of [2, 4, 8, 16]) {
    at = performance.now()
    const all = await pool(width, lane => gather(lane, pinned))
    report(`parallel ×${width}`, performance.now() - at, all, serial)
  }

// memo: a read pinned to one operation answers the same every time, so one
// call per distinct command serves every lane.
if (ways.has("memo")) {
  const seen = new Map<string, Promise<Ran>>()
  const memo: Runner = args => {
    const key = JSON.stringify(args)
    const ran = seen.get(key) ?? pinned(args)
    seen.set(key, ran)
    return ran
  }
  at = performance.now()
  const all: Gathered[] = []
  for (const lane of lanes) all.push(await gather(lane, memo))
  report("memo", performance.now() - at, all, serial)
  console.log(`  distinct commands run: ${seen.size}`)
}

// alias: a long union of commit ids parses slowly inline. The accepted thread
// commits become the revset `readShared` read them by, at the same operation;
// any other union of three or more commits an alias of itself, by --config.
const acceptedExpr = `(::present("pinetrie-accepted") & description(regex:"(?m)^(Pinetrie-Source|Pinetrie-Thread): "))`
const unions = /\((?:present\()?[0-9a-f]{40}\)?(?: \| (?:present\()?[0-9a-f]{40}\)?){2,}\)/g
const aliasing =
  (rest: Runner): Runner =>
  args => {
    const acceptedList = `(${shared.acceptedThreadCommits.map(t => `present(${t.commit})`).join(" | ")})`
    const defs = new Map<string, string>()
    const out = args.map(a =>
      a
        .split(acceptedList)
        .join("s253_accepted")
        .replace(unions, u => {
          const name = `s253_u${defs.size}`
          defs.set(name, u)
          return name
        }),
    )
    if (out.some(a => a.includes("s253_accepted"))) defs.set("s253_accepted", acceptedExpr)
    return rest([
      ...[...defs].flatMap(([n, v]) => ["--config", `revset-aliases.${n}=${JSON.stringify(v)}`]),
      ...out,
    ])
  }
if (ways.has("alias")) {
  at = performance.now()
  const all: Gathered[] = []
  for (const lane of lanes) all.push(await gather(lane, aliasing(pinned)))
  report("alias", performance.now() - at, all, serial)
  const byVerbA = new Map<string, { n: number; ms: number }>()
  for (const c of all.flatMap(g => g.calls)) {
    const v = byVerbA.get(verb(c)) ?? { n: 0, ms: 0 }
    byVerbA.set(verb(c), { n: v.n + 1, ms: v.ms + c.ms })
  }
  for (const [v, { n, ms }] of byVerbA)
    console.log(`  ${v}: ${n} calls, ${ms.toFixed(0)} ms, mean ${(ms / n).toFixed(1)}`)
  for (const width of [2, 4, 8, 16]) {
    at = performance.now()
    const par = await pool(width, lane => gather(lane, aliasing(pinned)))
    report(`alias, parallel ×${width}`, performance.now() - at, par, serial)
  }
}

// onelog: each lane's first call is its lane read; all of them as one jj log,
// each row tagged with the index of the lane whose revset holds it.
if (ways.has("onelog") || ways.has("git")) {
  const reads = serial.map(g => g.calls[0]?.args ?? [])
  const isLaneRead = (a: readonly string[]) =>
    a[0] === "log" && a.includes("-T") && a.includes("-r")
  const indexed = reads
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => isLaneRead(a))
  const revOf = (a: readonly string[]) => a[a.indexOf("-r") + 1] ?? ""
  const tplOf = (a: readonly string[]) => a[a.indexOf("-T") + 1] ?? ""
  // Every lane's revset names the accepted thread commits, hundreds of them:
  // one alias, and an alias per lane, in a config file, since one argument
  // holding them all is past the kernel's limit.
  const acceptedList = `(${shared.acceptedThreadCommits.map(t => `present(${t.commit})`).join(" | ")})`
  const aliased = (s: string) => s.split(acceptedList).join("s253_accepted")
  const toml = [
    "[revset-aliases]",
    `s253_accepted = ${JSON.stringify(acceptedExpr)}`,
    ...indexed.map(({ a, i }) => `s253_l${i} = ${JSON.stringify(aliased(revOf(a)))}`),
    "[template-aliases]",
    ...indexed.map(({ a, i }) => `s253_t${i} = ${JSON.stringify(aliased(tplOf(a)))}`),
  ].join("\n")
  const { writeFile } = await import("node:fs/promises")
  await writeFile("/tmp/s253/aliases.toml", toml)
  console.log(
    `\naccepted thread commits: ${shared.acceptedThreadCommits.length}, their list ${acceptedList.length} chars; a lane read ${reads[0]?.join(" ").length} chars`,
  )
  const one = [
    "--config-file",
    "/tmp/s253/aliases.toml",
    "log",
    "--no-graph",
    "-r",
    indexed.map(({ i }) => `s253_l${i}`).join(" | "),
    "-T",
    indexed
      .map(
        ({ i }) =>
          `if(self.contained_in("s253_l${i}"), "S253:${i}:" ++ s253_t${i})`,
      )
      .join(" ++ "),
  ]
  const oneAt = performance.now()
  const ran = await pinned(one)
  const oneMs = performance.now() - oneAt
  if (!ran.ok) throw new Error(ran.stderr)
  const rows = new Map<number, string[]>()
  for (const line of ran.stdout.split("\n").filter(Boolean)) {
    const cut = line.indexOf(":", 5)
    const i = Number(line.slice(5, cut))
    rows.set(i, [...(rows.get(i) ?? []), line.slice(cut + 1)])
  }
  console.log(
    `\none jj log for ${indexed.length} lane reads: ${oneMs.toFixed(0)} ms, ${ran.stdout.length} bytes; the separate reads: ${indexed.reduce((n, { i }) => n + (serial[i]?.calls[0]?.ms ?? 0), 0).toFixed(0)} ms`,
  )
  const served = (i: number, rest: Runner): Runner => args =>
    JSON.stringify(args) === JSON.stringify(reads[i])
      ? Promise.resolve({
          ok: true,
          code: 0,
          stdout: (rows.get(i) ?? []).map(r => `${r}\n`).join(""),
          stderr: "",
        })
      : rest(args)
  if (ways.has("onelog")) {
    at = performance.now()
    const all: Gathered[] = []
    for (const [i, lane] of lanes.entries())
      all.push(await gather(lane, served(i, pinned)))
    report("onelog (then serial)", performance.now() - at + oneMs, all, serial)
    for (const width of [1, 4, 8]) {
      at = performance.now()
      const par = await pool(width, lane => gather(lane, served(lanes.indexOf(lane), aliasing(pinned))))
      report(`onelog, then alias ×${width}`, performance.now() - at + oneMs, par, serial)
    }
  }

  // git: every diff a gather runs, compared with git's diff-tree of the same
  // two commits; then all of them as one git process.
  if (ways.has("git")) {
    const diffs = serial
      .flatMap(g => g.calls)
      .filter(c => c.args[0] === "diff" && c.args.includes("--from"))
    const pairs = [
      ...new Map(
        diffs.map(c => {
          const from = c.args[c.args.indexOf("--from") + 1] ?? ""
          const to = c.args[c.args.indexOf("--to") + 1] ?? ""
          return [`${from} ${to}`, { from, to, args: c.args }] as const
        }),
      ).values(),
    ]
    let same = 0
    const unlike: string[] = []
    for (const p of pairs) {
      const j = await pinned(["diff", "--from", p.from, "--to", p.to, "-T", 'json(path) ++ "\\n"'])
      const g = await git(["diff-tree", "-r", "--name-only", ...(ways.has("renames") ? ["-M"] : ["--no-renames"]), p.from, p.to])
      const jPaths = j.stdout.split("\n").filter(Boolean).map(l => JSON.parse(l) as string).sort()
      const gPaths = g.stdout.split("\n").filter(Boolean).sort()
      if (JSON.stringify(jPaths) === JSON.stringify(gPaths)) same++
      else unlike.push(`${p.from.slice(0, 8)}..${p.to.slice(0, 8)} jj ${jPaths.length} git ${gPaths.length}`)
    }
    console.log(`\n## git: ${pairs.length} distinct two-commit diffs (of ${diffs.length} calls), ${same} the same in git`)
    for (const u of unlike) console.log(`  unlike: ${u}`)
    const trees = await git(["rev-parse", ...pairs.flatMap(p => [`${p.from}^{tree}`, `${p.to}^{tree}`])])
    const ids = trees.stdout.split("\n").filter(Boolean)
    const input = pairs.map((_, k) => `${ids[2 * k]} ${ids[2 * k + 1]}`).join("\n") + "\n"
    const batchAt = performance.now()
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["diff-tree", "--stdin", "-r", "--name-only", ...(ways.has("renames") ? ["-M"] : ["--no-renames"])], { cwd: root })
      let s = ""
      child.stdout.on("data", d => {
        s += d
      })
      child.on("error", reject)
      child.on("close", () => resolve(s))
      child.stdin.end(input)
    })
    console.log(
      `  one git rev-parse + one git diff-tree --stdin for all ${pairs.length}: ${(performance.now() - batchAt + (calls.at(-1)?.ms ?? 0)).toFixed(0)} ms, ${out.split("\n").length} lines; the jj diffs: ${diffs.reduce((n, c) => n + c.ms, 0).toFixed(0)} ms`,
    )
  }
}
