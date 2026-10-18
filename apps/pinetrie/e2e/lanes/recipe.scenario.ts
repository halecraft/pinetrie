// e2e/lanes/recipe — what commands make is learnt, not declared: a turn's
// record classes what its runs wrote; and a catch up, or a run's start, after
// a file a recipe read changed removes what it made, its cache kept. The
// project's build is offline: it writes `out-<p>/marker` for each package
// `pkgs.txt` lists, and each package into `.store/`, a cache with a
// `CACHEDIR.TAG`.

import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  ancestry,
  CATCH_UP_TOOL,
  type EntryId,
  entryId,
  messageText,
  type RevisionRecord,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readRevisions } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import {
  at,
  committedProject,
  heldEntries,
  heldLanes,
  heldRootRecords,
  heldTree,
  idleNow,
  join,
  laneHolding,
  START_AGENT,
  setUpAccepted,
  waitFor,
} from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { jj } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => recipeSection(check, lanes),
}

const GONE =
  'for p in a b c; do test -e "out-$p" && echo "out-$p"; done; echo checked'

async function recipeSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const project = await committedProject("pinetrie-recipe-", {
    "pkgs.txt": "a\nb\nc\n",
    "c.txt": "c's source\n",
    "build.sh":
      'mkdir -p .store && touch .store/CACHEDIR.TAG && for p in $(cat pkgs.txt); do echo "$p" > ".store/$p"; mkdir -p "out-$p" && echo built > "out-$p/marker"; done\n',
    ".gitignore": "out-*/\n.env\n.store/\n",
    "pinetrie.json": `${JSON.stringify({ publish: { catchUp: true } })}\n`,
  })
  const script = scriptedModel()
  const wh = await lanes.startHost({
    model: { kind: "scripted", script },
    project: { dir: project, tools: true },
    log: m => {
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  const wu = await join(wh, "uma", "recipe")
  await wu.request({ kind: "name", name: "Uma" })
  const tree = () => heldTree(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 180_000)
    await wh.quiet()
  }
  const laneTip = (lane: ThreadId) =>
    heldLanes(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** The lane whose thread holds `text`. */
  const laneWith = (text: string) =>
    laneHolding(wh, readPlaces(wh.places), text)?.name
  /** The last tool result's text in a lane's thread. */
  const lastResult = (lane: ThreadId | undefined): string => {
    if (lane === undefined) return ""
    const onPath = new Set(ancestry(tree(), laneTip(lane)).path)
    return (
      Object.values(heldEntries(wh))
        .filter(r => onPath.has(entryId(r.id)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(r => rowMessage(r) as { role?: string })
        .filter(m => m.role === "toolResult")
        .map(m => messageText(m as never))
        .at(-1) ?? ""
    )
  }
  /** The revision records of a lane's thread, oldest first. */
  const recordsOf = (lane: ThreadId): RevisionRecord[] => {
    const records = heldRootRecords(wh, readRevisions)
    return ancestry(tree(), laneTip(lane))
      .path.map(id => records.get(id as EntryId))
      .filter((r): r is RevisionRecord => r !== undefined && r.lane === lane)
      .sort((a, b) => (a.entry < b.entry ? -1 : 1))
  }
  const ask = async (
    text: string,
    command: string,
    where = ROOT,
    how: Parameters<typeof wu.send>[2] = START_AGENT,
  ) => {
    script.use([{ tool: "bash", args: { command } }, { text: "done" }])
    await wu.send(text, where, how)
    await idle()
    return laneWith(text)
  }

  try {
    await setUpAccepted(wh.session, wu)
    // A new thread forks from the base, which runs no command.
    const first = await ask("@agent which outputs are there first?", GONE)
    if (first === undefined) throw new Error("no lane")

    // A turn of three runs: one makes outputs and a cache from source, one
    // writes an ignored file from nothing, one makes a directory from
    // source that no `.gitignore` names.
    script.use([
      { tool: "bash", args: { command: "sh build.sh" } },
      { tool: "bash", args: { command: "echo SECRET=1 > .env" } },
      {
        tool: "bash",
        args: { command: "mkdir -p dist && cp pkgs.txt dist/pkgs.txt" },
      },
      { text: "wrote them" },
    ])
    const earlier = recordsOf(first).length
    await wu.send("@agent build, and write .env", at(laneTip(first)), {
      thread: first,
    })
    await idle()
    // Each tool call is a turn of its own, with its own record.
    const wrote = recordsOf(first).slice(earlier)
    const derived = wrote.flatMap(r => r.disk?.derived.paths ?? [])
    const local = wrote.flatMap(r => r.disk?.private.paths ?? [])
    check(
      "a turn's record names its runs' outputs derived, and a file a command wrote from nothing local",
      derived.includes("out-a") &&
        local.includes(".env") &&
        !local.some(p => p.startsWith("out-")) &&
        // No record names a path only the diff's own machinery made.
        !recordsOf(first).some(r =>
          (r.disk?.private.paths ?? []).some(
            p => /^o\d+-\d+-\d+(\/|$)/.test(p) || p.startsWith(".git/"),
          ),
        ),
      JSON.stringify(wrote.map(r => r.disk)),
    )
    check(
      "a directory a run made from source that .gitignore misses is named in the turn's record",
      wrote.some(r => r.disk?.unignored.includes("dist") === true),
      JSON.stringify(wrote.map(r => r.disk?.unignored)),
    )

    // Accepted work deletes package c; the lane catches up.
    await jj(project, "bookmark", "create", "main", "-r", "pinetrie-accepted")
    writeFileSync(path.join(project, "pkgs.txt"), "a\nb\n")
    rmSync(path.join(project, "c.txt"))
    await jj(project, "commit", "-m", "you delete package c")
    await wu.actOnAccepted("publish")
    await wh.quiet()
    script.use([
      { tool: CATCH_UP_TOOL, args: {} },
      { tool: "bash", args: { command: `${GONE}; ls .store` } },
      { text: "caught up" },
    ])
    await wu.send("@agent catch up", at(laneTip(first)), { thread: first })
    await idle()
    const after = lastResult(first)
    check(
      "a catch up that changes what a recipe read removes what it made, and keeps its cache",
      after.trim() === "checked\nCACHEDIR.TAG\na\nb\nc",
      JSON.stringify(after),
    )

    // The lane builds, then changes what the build read: its next run
    // starts without the outputs that went stale.
    script.use([
      { tool: "bash", args: { command: "sh build.sh" } },
      { tool: "bash", args: { command: "printf 'a\\n' > pkgs.txt" } },
      { text: "built, then changed" },
    ])
    await wu.send("@agent build, then drop package b", at(laneTip(first)), {
      thread: first,
    })
    await idle()
    script.use([{ tool: "bash", args: { command: GONE } }, { text: "looked" }])
    await wu.send("@agent which outputs now?", at(laneTip(first)), {
      thread: first,
    })
    await idle()
    check(
      "a run starts without the outputs of a recipe whose input changed since",
      lastResult(first).trim() === "checked",
      JSON.stringify(lastResult(first)),
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, project)
  }
}
