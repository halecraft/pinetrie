// e2e/lanes/proposal — an agent proposes three branches; a person's Start
// opens them after the proposing thread in the proposal's order, each a
// lane of its own forked where the run ended and asked its brief as the
// presser's message; the press leaves a fact in the proposing thread.

import {
  entryThread,
  messageProposal,
  PROPOSE_TOOL,
  projectTranscript,
  ROOT,
  type ThreadId,
  threadEnd,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readThreads } from "@pinetrie/reads"
import { cardsOnCanvas } from "@pinetrie/rules"
import { newThreadId } from "@pinetrie/session"
import type { Checks } from "../checks.ts"
import { canvasHolding, heldTree, START_AGENT, waitFor } from "../harness.ts"
import { inLane, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

const BRANCHES = [
  { title: "one", brief: "do one" },
  { title: "two", brief: "do two" },
  { title: "three", brief: "do three" },
]

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const script = scriptedModel({
    answer: { reply: context => `done: ${context.at(-1) ?? ""}` },
  })
  const { user, idle, host, close } = await lanes.sectionHost({
    files: { "a.txt": "base\n" },
    model: { kind: "scripted", script },
  })
  try {
    // The proposing run writes a file, proposes, and ends on its list.
    script.use([
      { tool: "write", args: { path: "parent.txt", content: "from parent\n" } },
      { tool: PROPOSE_TOOL, args: { branches: BRANCHES } },
      { text: "three things" },
    ])
    await user.send("@agent split it", ROOT, START_AGENT)
    await idle()
    const tree = heldTree(host)
    const result = Object.values(tree.entries).find(
      e => messageProposal(e.message) !== undefined,
    )?.id
    const parent = result === undefined ? null : entryThread(tree, result)
    const root =
      parent === null ? undefined : readThreads(host.session).get(parent)?.root
    if (result === undefined || parent === null || root === undefined)
      throw new Error("no proposal")
    const canvas = canvasHolding(host, result)
    const threads: ThreadId[] = BRANCHES.map(() => newThreadId())
    const [t0, t1, t2] = threads
    if (t0 === undefined || t1 === undefined || t2 === undefined)
      throw new Error("three threads")
    const pressed = await user.request({
      kind: "branch-out",
      how: "start",
      root,
      canvas,
      proposal: result,
      branches: [
        { thread: t0, row: 0, brief: "do one" },
        { thread: t1, row: 1, brief: "do two" },
        { thread: t2, row: 2, brief: "do three" },
      ],
    })
    await idle()
    const after = heldTree(host)
    const ids = cardsOnCanvas(readPlaces(host.places), canvas).map(c => c.id)
    const at = ids.indexOf(parent)
    const prompts = threads.map(t => {
      const said = projectTranscript(after, threadEnd(after, t))
      return said.find(m => m.thread === t && m.role === "person")
    })
    const files = await Promise.all(
      threads.map(t => inLane(t, "cat parent.txt").catch(e => `ERR ${e}`)),
    )
    check(
      "Start opens each branch right after the proposing thread in the proposal's order, each a lane of its own asked its brief by the presser",
      pressed.kind === "moved" &&
        ids.slice(at + 1, at + 4).join() === threads.join() &&
        prompts.every(
          (m, i) =>
            m?.role === "person" &&
            m.writer === user.writer &&
            m.compelled &&
            m.text === `@agent ${BRANCHES[i]?.brief}`,
        ) &&
        files.every(f => f === "from parent\n"),
      `${pressed.kind}; canvas ${ids.slice(at, at + 4).join()}; prompts ${prompts.map(m => m?.text).join(" | ")}; files ${JSON.stringify(files)}`,
    )

    // The fact reaches the proposing thread once it is idle.
    let said: readonly string[] = []
    await waitFor(() => {
      const now = heldTree(host)
      said = projectTranscript(now, threadEnd(now, parent))
        .filter(m => m.role === "fact")
        .map(m => m.text)
      return said.length > 0
    }, 30_000).catch(() => {})
    check(
      "the press leaves a fact in the proposing thread",
      said.includes("⑂ 3 branches started from the proposal"),
      said.join(" | "),
    )
  } finally {
    await close()
  }
}
