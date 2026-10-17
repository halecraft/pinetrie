// e2e/lanes/catch-up — the agent catches its thread up in the middle of its
// run, and an acceptance leaves a fact in the thread.

import { writeFileSync } from "node:fs"
import path from "node:path"
import {
  ancestry,
  CATCH_UP_TOOL,
  type EntryId,
  entryId,
  messageText,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readRevisions } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import {
  at,
  BRANCH,
  committedProject,
  entriesOf,
  idleNow,
  join,
  laneHolding,
  lanesOf,
  rootRecordsOf,
  START_AGENT,
  setUpAccepted,
  treeOf,
  waitFor,
} from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { jj } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => catchUpSection(check, lanes),
}

async function catchUpSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const project = await committedProject("pinetrie-catch-up-", {
    "a.txt": "a\n",
    ".gitignore": "node_modules/\n.vite/\n",
    // A publish here accepts your commit.
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
  const wu = await join(wh, "uma", "catch-up")
  await wu.request({ kind: "name", name: "Uma" })
  const tree = () => treeOf(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 180_000)
    await wh.quiet()
  }
  const laneTip = (lane: ThreadId) =>
    lanesOf(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** The lane whose thread's end holds `text`. */
  const laneWith = (text: string) =>
    laneHolding(wh, readPlaces(wh.places), text)
  /** Every tool result's text in a lane's thread, oldest first. */
  const toolResults = (lane: ThreadId | undefined): string[] => {
    if (lane === undefined) return []
    const onPath = new Set(ancestry(tree(), laneTip(lane)).path)
    return Object.values(entriesOf(wh))
      .filter(r => onPath.has(entryId(r.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }

  try {
    await setUpAccepted(wh.session, wu)
    // A thread with work of its own.
    script.use([
      { tool: "bash", args: { command: "echo lane > lane.txt" } },
      { text: "started" },
    ])
    await wu.send("@agent start", ROOT, START_AGENT)
    await idle()
    const lane = laneWith("@agent start")?.name
    if (lane === undefined) throw new Error("no lane")

    // Accepted work moves on: your commit, published, which accepts it and
    // moves main.
    await jj(project, "bookmark", "create", "main", "-r", "pinetrie-accepted")
    writeFileSync(path.join(project, "landed.txt"), "landed\n")
    await jj(project, "commit", "-m", "you land landed.txt")
    await wu.actOnAccepted("publish")
    await wh.quiet()

    // The agent catches up in its run, alone in its turn, then reads the
    // file that came in.
    script.use([
      { tool: CATCH_UP_TOOL, args: {} },
      { tool: "bash", args: { command: "cat landed.txt" } },
      { text: "caught up" },
    ])
    await wu.send("@agent catch up", at(laneTip(lane)), { thread: lane })
    await idle()
    const results = toolResults(lane)
    // The turn that called it records the merge: a branch
    // there starts with the merged file.
    const index = tree()
    const call = ancestry(index, laneTip(lane)).path.find(id => {
      const content = index.entries[id]?.message?.content
      return (
        Array.isArray(content) &&
        content.some(
          p =>
            (p as { type?: string; name?: string }).type === "toolCall" &&
            (p as { name?: string }).name === CATCH_UP_TOOL,
        )
      )
    })
    const recorded =
      call === undefined
        ? undefined
        : rootRecordsOf(wh, readRevisions).get(call as EntryId)
    script.use([
      { tool: "bash", args: { command: "cat landed.txt" } },
      { text: "branched" },
    ])
    await wu.send("@agent branch at the catch-up", at(call ?? null), BRANCH)
    await idle()
    const branched = laneWith("@agent branch at the catch-up")?.name
    check(
      "a catch_up mid-run merges accepted work, and a branch at its turn has accepted work's file",
      results.some(r => r.includes("landed.txt")) &&
        results.at(-1)?.trim() === "landed" &&
        recorded?.point !== null &&
        recorded !== undefined &&
        toolResults(branched).at(-1)?.trim() === "landed",
      `${JSON.stringify({ results, recorded, branched: toolResults(branched) })}`,
    )

    // An acceptance leaves a fact in the thread.
    const accepted = await wu.proposed(lane, "accept", "pinetrie-accepted")
    const fact = await waitFor(() => {
      const now = tree()
      return ancestry(now, laneTip(lane)).path.some(
        id => now.entries[id]?.message?.role === "fact",
      )
    }, 30_000)
    check(
      "an acceptance leaves a fact the thread shows",
      accepted.kind === "accepted" && fact >= 0,
      `${JSON.stringify({ accepted, fact })}`,
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, project)
  }
}
