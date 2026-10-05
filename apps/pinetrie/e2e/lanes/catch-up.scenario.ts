// e2e/lanes/catch-up — the agent catches its thread up in the middle of its
// run (ADR-0080, S103), and an offer integration leaves a fact in the thread.

import { writeFileSync } from "node:fs"
import path from "node:path"
import {
  ancestry,
  CATCH_UP_TOOL,
  type EntryId,
  entryId,
  type LaneName,
  messageText,
  projectTranscript,
  ROOT,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readRevisions } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  containerProblem,
  entriesOf,
  idleNow,
  join,
  lanesOf,
  rootRecordsOf,
  setUpLine,
  startSuiteHost,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { at, BRANCH, cleanUp, jj, START_AGENT } from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => catchUpSection(check),
}

async function catchUpSection(check: Checks["check"]): Promise<void> {
  const project = committedProject("pinetrie-catch-up-", {
    "a.txt": "a\n",
    ".gitignore": "node_modules/\n.vite/\n",
  })
  const script = scriptedModel()
  const wh = await startSuiteHost({
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
  const laneTip = (lane: LaneName) =>
    lanesOf(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** The lane whose thread's end holds `text`. */
  const laneWith = (text: string) => {
    const index = tree()
    const id =
      Object.values(index.entries).find(
        e => projectTranscript(index, e.id).at(-1)?.text === text,
      )?.id ?? null
    return lanesOf(wh, index, readPlaces(wh.places)).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  /** Every tool result's text in a lane's thread, oldest first. */
  const toolResults = (lane: LaneName | undefined): string[] => {
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
    await setUpLine(wh.session, wu)
    // A thread with work of its own.
    script.use([
      { tool: "bash", args: { command: "echo lane > lane.txt" } },
      { text: "started" },
    ])
    await wu.chat("@agent start", ROOT, START_AGENT)
    await idle()
    const lane = laneWith("@agent start")?.name
    if (lane === undefined) throw new Error("no lane")

    // The project moves on: your commit, landed on the line.
    writeFileSync(path.join(project, "landed.txt"), "landed\n")
    jj(project, "commit", "-m", "you land landed.txt")
    await wu.line("land")
    await wh.quiet()

    // The agent catches up in its run, alone in its turn, then reads the
    // file that came in.
    script.use([
      { tool: CATCH_UP_TOOL, args: {} },
      { tool: "bash", args: { command: "cat landed.txt" } },
      { text: "caught up" },
    ])
    await wu.chat("@agent catch up", at(laneTip(lane)), { lane })
    await idle()
    const results = toolResults(lane)
    // The turn that called it records the merge (S103 item 3): a branch
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
    await wu.chat("@agent branch at the catch-up", at(call ?? null), BRANCH)
    await idle()
    const branched = laneWith("@agent branch at the catch-up")?.name
    check(
      "a catch_up mid-run merges the line, and a branch at its turn has the line's file",
      results.some(r => r.includes("landed.txt")) &&
        results.at(-1)?.trim() === "landed" &&
        recorded?.commit !== null &&
        recorded !== undefined &&
        toolResults(branched).at(-1)?.trim() === "landed",
      `${JSON.stringify({ results, recorded, branched: toolResults(branched) })}`,
    )

    // An offer integration leaves a fact in the thread (ADR-0080).
    const integrated = await wu.offer(lane, "integrate", "pinetrie-onto")
    const fact = await waitFor(() => {
      const now = tree()
      return ancestry(now, laneTip(lane)).path.some(
        id => now.entries[id]?.message?.role === "fact",
      )
    }, 30_000)
    check(
      "an offer integration leaves a fact the thread shows",
      integrated.kind === "integrated" && fact >= 0,
      `${JSON.stringify({ integrated, fact })}`,
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    cleanUp(wh.session, project)
  }
}
