// e2e/lanes/store-upkeep — the disk upkeep under a budget no turn's
// snapshot fits: a lane's old turns' snapshots evicted, its newest and the
// base kept; a branch from an evicted turn in a jj project keeping that
// turn's files; and in a folder project, every state accepted work keeps
// left to the folder code.

import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BASE_SNAPSHOT,
  entryId,
  type RevisionRecord,
  ROOT,
  snapshotOwner,
  type ThreadId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readAccepted, readPlaces, readRevisions } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import { ancestry, messageText } from "@pinetrie/threads"
import type { RunningHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  at,
  BRANCH,
  committedProject,
  heldEntries,
  heldLanes,
  heldRootRecords,
  heldTree,
  idleNow,
  join,
  laneHolding,
  START_AGENT,
  SUITE_CONFIG,
  setUpAccepted,
  suitePlaces,
  waitFor,
} from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { projectSnapshots } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: async ({ check }, { lanes }) => {
    await jjSection(check, lanes)
    await folderSection(check, lanes)
  },
}

/** The suite's config, with a snapshot budget no turn's snapshot fits. */
const TIGHT = { ...SUITE_CONFIG, lanes: { store: { snapshotMetadata: "1K" } } }

/** A host over `dir` with the tight budget, its person, and its reads. */
async function tightHost(lanes: LaneHosts, dir: string, name: string) {
  const script = scriptedModel()
  const wh = await lanes.startHost({
    model: { kind: "scripted", script },
    places: suitePlaces({ user: TIGHT }),
    project: { dir, tools: true },
    log: m => {
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  const wu = await join(wh, "uma", name)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 300_000)
    await wh.quiet()
  }
  const laneWith = (text: string) =>
    laneHolding(wh, readPlaces(wh.places), text)?.name
  return { script, wh, wu, idle, laneWith }
}

/** Every tool result's text in a lane's thread, oldest first. */
function toolResults(wh: RunningHost, lane: ThreadId | undefined): string[] {
  if (lane === undefined) return []
  const tree = heldTree(wh)
  const tip =
    heldLanes(wh, tree, readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  const onPath = new Set(ancestry(tree, tip).path)
  return Object.values(heldEntries(wh))
    .filter(r => onPath.has(entryId(r.id)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(r => rowMessage(r) as { role?: string })
    .filter(m => m.role === "toolResult")
    .map(m => messageText(m as never))
}

/** Three turns, each writing `a.txt` anew. */
const THREE_TURNS = [
  { tool: "bash", args: { command: "echo one > a.txt" } },
  { tool: "bash", args: { command: "echo two > a.txt" } },
  { tool: "bash", args: { command: "echo three > a.txt" } },
  { text: "wrote" },
] as const

async function jjSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const project = await committedProject("pinetrie-store-upkeep-", {
    "a.txt": "base\n",
  })
  const { script, wh, wu, idle, laneWith } = await tightHost(
    lanes,
    project,
    "store-upkeep",
  )
  try {
    await setUpAccepted(wh.session, wu)
    script.use([...THREE_TURNS])
    await wu.send("@agent write", ROOT, START_AGENT)
    await idle()
    const lane = laneWith("@agent write")
    // Each turn that wrote `a.txt`: the prompt's own record changed nothing.
    const turns = [...heldRootRecords(wh, readRevisions).values()]
      .filter(
        (
          r,
        ): r is RevisionRecord & {
          snapshot: NonNullable<RevisionRecord["snapshot"]>
        } =>
          r.lane === lane && r.snapshot !== null && r.paths.includes("a.txt"),
      )
      .sort((a, b) => (a.entry < b.entry ? -1 : 1))
    const there = await projectSnapshots(project)
    const first = turns[0]
    const newest = turns.at(-1)
    check(
      "the upkeep evicts a lane's old turns' snapshots under its budget, and keeps its newest and the base",
      turns.length >= 3 &&
        first !== undefined &&
        newest !== undefined &&
        !there.has(first.snapshot) &&
        there.has(newest.snapshot) &&
        there.has(BASE_SNAPSHOT),
      `${turns.length} turns: ${turns.map(t => `${t.paths.join(",")} ${there.has(t.snapshot) ? "kept" : "gone"}`).join(" | ")} | base ${there.has(BASE_SNAPSHOT)}`,
    )

    script.use([
      { tool: "bash", args: { command: "cat a.txt" } },
      { text: "read" },
    ])
    await wu.send("@agent read", at(first?.entry ?? null), BRANCH)
    await idle()
    const read = toolResults(wh, laneWith("@agent read")).at(-1)?.trim()
    check(
      "a branch from an evicted turn keeps that turn's files",
      read === "one",
      `read ${JSON.stringify(read)}`,
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, project)
  }
}

/** A folder of `files` with no repo, readable by a rootless Docker's user. */
function plainFolder(files: Readonly<Record<string, string>>): string {
  const dir = realpathSync(
    mkdtempSync(path.join(tmpdir(), "pinetrie-store-upkeep-folder-")),
  )
  chmodSync(dir, 0o755)
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  return dir
}

async function folderSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const dir = plainFolder({ "a.txt": "base\n" })
  const { script, wh, wu, idle } = await tightHost(
    lanes,
    dir,
    "store-upkeep-folder",
  )
  try {
    script.use([...THREE_TURNS])
    await wu.send("@agent write", ROOT, START_AGENT)
    await idle()
    const there = await projectSnapshots(dir)
    const accepted = readAccepted(wh.session)
    const kept = accepted?.kind === "folder" ? accepted.kept : []
    const states = [...there].filter(s => snapshotOwner(s) === "folder-state")
    check(
      "the upkeep never deletes a folder state",
      kept.length > 0 &&
        kept.every(k => there.has(k as never)) &&
        states.length > 0,
      `kept ${kept.length}, listed ${states.length} folder states`,
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, dir)
  }
}
