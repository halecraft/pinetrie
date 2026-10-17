// Disposable probe for a spike: a fork a host stopped part way, left as the
// first of `planFork`'s steps leaves a disk (restored from its source, its
// setup not run), then a host started again over the same store.

import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ancestry,
  BASE_SNAPSHOT,
  type RevisionRecord,
  ROOT,
  type SnapshotId,
  type ThreadId,
} from "@pinetrie/core"
import { projectKey } from "@pinetrie/docker"
import { ONCE, serverArgs } from "@pinetrie/lanehost"
import { PINETRIE_MOUNT, runtimeNode } from "@pinetrie/lanes"
import { readRevisions } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import {
  at,
  BRANCH,
  heldRootRecords,
  heldTree,
  START_AGENT,
} from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import { cli, container, dockerDisks, inDisks } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"
import { jj } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => probe(check, lanes),
}

const say = (label: string, value: unknown) =>
  console.log(
    `PROBE ${label}: ${typeof value === "string" ? value : JSON.stringify(value, null, 1)}`,
  )

async function disksContainer(root: string): Promise<string> {
  const out = await cli([
    "ps",
    "--filter",
    `label=pinetrie.project=${projectKey(root)}`,
    "--filter",
    "label=pinetrie.lanehost=disks",
    "--format",
    "{{.Names}}",
  ])
  const name = out.split("\n").find(l => l.trim() !== "")
  if (name === undefined) throw new Error("no disks container")
  return name
}

async function restoreAs(root: string, lane: ThreadId, from: SnapshotId) {
  const name = await disksContainer(root)
  const lanesDir = path.dirname(path.dirname(dockerDisks(root).dir))
  for (const op of [
    { kind: "delete", lane },
    { kind: "restore", lane, from },
  ])
    await cli([
      "exec",
      name,
      ...runtimeNode(`${PINETRIE_MOUNT}/${ONCE}`),
      ...serverArgs("disks", lanesDir, { rootless: false }),
      JSON.stringify({ kind: "disk", project: projectKey(root), op }),
    ])
}

const INSPECT =
  "cd /workspace; echo '--bookmarks'; jj bookmark list 2>&1; echo '--log'; jj log --no-graph -r '::@ ~ root()' -T 'change_id.short() ++ \" \" ++ commit_id.short() ++ \" \" ++ bookmarks ++ \" \" ++ description.first_line() ++ \"\\n\"' 2>&1 | head -8; echo '--config'; cat .pinetrie-lane/jj.toml 2>&1; echo '--immutable'; jj log --no-graph -r 'immutable_heads()' -T 'commit_id.short() ++ \"\\n\"' 2>&1 | head -3"

async function probe(check: Checks["check"], lanes: LaneHosts) {
  const logs: string[] = []
  const store = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-store-"))),
    "pinetrie.db",
  )
  let h = await lanes.sectionHost({
    files: { "a.txt": "base\n" },
    store,
    logs,
  })
  const { dir } = h
  const revisionsOf = (lane: ThreadId): RevisionRecord[] =>
    [...heldRootRecords(h.host, readRevisions).values()]
      .filter(r => r.lane === lane)
      .sort((a, b) => (a.entry < b.entry ? -1 : 1))
  try {
    // A: a root lane with a commit. P: a root lane whose run is text only.
    h.script.use([
      { tool: "bash", args: { command: "echo a > a.txt" } },
      { text: "a done" },
    ])
    await h.user.send("@agent A writes", ROOT, START_AGENT)
    await h.idle()
    h.script.use([{ text: "hello" }])
    await h.user.send("@agent P says hello", ROOT, START_AGENT)
    await h.idle()
    const A = h.laneWith("@agent A writes")
    const P = h.laneWith("@agent P says hello")
    if (A === undefined || P === undefined) throw new Error("no lanes")
    say("P's records (text-only run)", revisionsOf(P.name))
    // B: a branch from A's turn. C: a root lane. Both text only, so each
    // fork runs whole first.
    h.script.use([{ text: "b here" }])
    await h.user.send("@agent B branches", at(A.tip), BRANCH)
    await h.idle()
    h.script.use([{ text: "c here" }])
    await h.user.send("@agent C starts", ROOT, START_AGENT)
    await h.idle()
    const B = h.laneWith("@agent B branches")
    const C = h.laneWith("@agent C starts")
    if (B === undefined || C === undefined) throw new Error("no lanes B C")
    const aSnap = revisionsOf(A.name)
      .map(r => r.snapshot)
      .filter((s): s is SnapshotId => s !== null)
      .at(-1)
    if (aSnap === undefined) throw new Error("A has no snapshot")
    say("names", { A: A.name, P: P.name, B: B.name, C: C.name, aSnap })
    say("B whole, before", await inDisks(dir, `ls -a ${dockerDisks(dir).lane(B.name)} | head -20`))
    // A fork stopped after its clone: each disk as its source's snapshot,
    // replaced while the host still holds the slot lanehost runs in.
    await h.host.quiet()
    for (const l of [B.name, C.name])
      await cli(["rm", "-f", container(l)]).catch(() => "")
    await restoreAs(dir, B.name, aSnap)
    await restoreAs(dir, C.name, BASE_SNAPSHOT)
    say("B half, after", await inDisks(dir, `ls -a ${dockerDisks(dir).lane(B.name)} | head -20`))
    await h.close(true)

    logs.length = 0
    h = await lanes.sectionHost({ dir, store, logs })
    for (const [l, text] of [
      [B.name, "@agent B branches"],
      [C.name, "@agent C starts"],
    ] as const) {
      const tip = h.laneWith(text)?.tip ?? null
      h.script.use([
        { tool: "bash", args: { command: INSPECT } },
        { tool: "bash", args: { command: `echo ${l} > mine.txt` } },
        { text: "written" },
      ])
      await h.user.send(`${l} looks`, at(tip), { thread: l })
      const results = await h.results(text)
      say(`${l} inspected`, results.at(-2) ?? "")
      say(`${l} wrote`, results.at(-1) ?? "")
      say(`${l} records`, revisionsOf(l).map(r => ({ point: r.point, snapshot: r.snapshot !== null })))
    }
    // A goes on: does its next commit share a change with B's?
    h.script.use([
      { tool: "bash", args: { command: "echo a2 > a.txt" } },
      { text: "a again" },
    ])
    await h.user.send("A again", at(h.laneWith("@agent A writes")?.tip ?? null), {
      thread: A.name,
    })
    await h.idle()
    await h.host.quiet()
    say(
      "your repo",
      await jj(
        dir,
        "log",
        "--no-graph",
        "-r",
        "bookmarks(glob:\"pinetrie*\") | tags() | remote_bookmarks()",
        "-T",
        'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ divergent ++ " " ++ bookmarks ++ " " ++ description.first_line() ++ "\\n"',
      ).catch(e => String(e)),
    )
    say(
      "your repo, all",
      await jj(
        dir,
        "log",
        "--no-graph",
        "-r",
        "all() ~ root()",
        "-T",
        'change_id.short() ++ " " ++ commit_id.short() ++ " div=" ++ divergent ++ " [" ++ bookmarks ++ "] " ++ description.first_line() ++ "\\n"',
      ).catch(e => String(e)),
    )
    say(
      "host lines",
      logs.filter(l => /fail|cannot|refus|divergent|error/i.test(l)),
    )
    say("tree size", Object.keys(heldTree(h.host).entries).length)
    void ancestry
    check("the probe ran", true)
  } finally {
    await h.close()
    rmSync(path.dirname(store), { recursive: true, force: true })
  }
}
