// e2e/host/agents — another canvas's thread's agent invited, asked by this
// thread's agent, and its answer waking the asker; then its canvas archived,
// which refuses the next ask; then a budget spent, which wakes nobody.

import {
  messageText,
  projectTranscript,
  ROOT,
  type ThreadId,
  threadEnd,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import {
  readNames,
  readPlaces,
  readRecords,
  readThreads,
  readWorkflow,
} from "@pinetrie/reads"
import { BUDGET } from "@pinetrie/rules"
import type { Checks } from "../checks.ts"
import {
  at,
  boardStateOf,
  canvasHolding,
  START_AGENT,
  SUITE_CONFIG,
  suitePlaces,
  treeOf,
} from "../harness.ts"
import type { LaneHosts, SectionHost } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

/** What each request answers, from the last message it reads. */
const replies = (last: string): string =>
  last.includes("asks you:")
    ? "B-ANSWER: a queue is right"
    : last.includes("answers, from its own thread")
      ? "A-NOTED"
      : "ok"

/** The suite's places, with a budget for agents talking. */
const placesWith = (budget: number) =>
  suitePlaces({ user: { ...SUITE_CONFIG, agents: { budget } } })

/**
 * Two agent threads, A and B, each started at the root, so each is a canvas
 * of its own: every check below crosses canvases and root
 * documents. B's name.
 */
async function twoThreads(section: SectionHost) {
  const { user, idle, host } = section
  const threadsNow = () => [...treeOf(host).endOf.keys()]
  await user.send("@agent you are A", ROOT, START_AGENT)
  await idle()
  const [a] = threadsNow()
  await user.send("@agent you are B", ROOT, START_AGENT)
  await idle()
  const b = threadsNow().find(t => t !== a)
  if (a === undefined || b === undefined) throw new Error("two threads start")
  return { a, b, bName: readNames(host.session).get(b) ?? "" }
}

/** The transcript of `thread`, as its texts with their roles. */
const said = (host: SectionHost["host"], thread: ThreadId) => {
  const tree = treeOf(host)
  return projectTranscript(tree, threadEnd(tree, thread)).map(
    m => `${m.role}: ${m.text}`,
  )
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // 1. A person invites B into A; A's agent asks it; its answer wakes A.
  {
    const script = scriptedModel({
      answer: { reply: context => replies(context.at(-1) ?? "") },
    })
    const section = await lanes.sectionHost({
      files: { "a.txt": "a\n" },
      model: { kind: "scripted", script },
      places: placesWith(1_000_000),
    })
    const { user, idle, host, close } = section
    try {
      const { a, b, bName } = await twoThreads(section)
      const end = threadEnd(treeOf(host), a)
      script.use([{ tool: "ask", args: { to: bName, text: "queue or not?" } }])
      await user.send(`Please talk to @${bName} about queues`, at(end), {
        thread: a,
      })
      await idle()
      const inA = said(host, a)
      const inB = said(host, b)
      const invited = Object.values(treeOf(host).entries).some(e =>
        (e.message?.invites ?? []).includes(b),
      )
      check(
        "a first mention of another thread's agent invites it, and the thread's own agent is asked",
        invited && inA.some(l => l.startsWith("assistant")),
        `invited ${invited}`,
      )
      check(
        "an agent's ask runs the other thread's agent, on what it heard and then the ask",
        inB.some(l => l.startsWith("heard: heard in")) &&
          inB.some(l => l.startsWith("relay:")) &&
          inB.some(l => l.includes("B-ANSWER")),
        inB.slice(-4).join(" | "),
      )
      const answered = inA.findIndex(l => l.startsWith("answer:"))
      check(
        "the answer comes back to the asking thread, and wakes its agent",
        answered >= 0 &&
          inA.slice(answered + 1).some(l => l.includes("A-NOTED")),
        inA.slice(-4).join(" | "),
      )
      const budget = [...readRecords(host.session, BUDGET).values()][0]
      check(
        "what the other thread's agent spent is counted in the budget",
        budget !== undefined && budget.spent > 0 && !budget.over,
        JSON.stringify(budget ?? null),
      )

      // B's canvas archived: its root is let go, and A's ask of it is
      // refused with why, never opening that root again.
      const done = readWorkflow(host.session)?.archive
      const bCanvas = canvasHolding(host, threadEnd(treeOf(host), b))
      const bRoot = readThreads(host.session).get(b)?.root
      const state = boardStateOf(readPlaces(host.places), bCanvas)
      if (done === undefined || state === undefined || bRoot === undefined)
        throw new Error("B's canvas is on the board")
      await user.request({
        kind: "move-canvas",
        canvas: bCanvas,
        from: state,
        to: done.id,
        before: null,
      })
      await idle()
      script.use([{ tool: "ask", args: { to: bName, text: "and now?" } }])
      await user.send("@agent ask it again", at(threadEnd(treeOf(host), a)), {
        thread: a,
      })
      await idle()
      // A tool's result is no transcript message: read the results stored.
      const refused = Object.values(treeOf(host).entries).flatMap(e =>
        e.message?.role === "toolResult" &&
        messageText(e.message).includes("archived by")
          ? [messageText(e.message)]
          : [],
      )
      check(
        "an ask of a member whose canvas was archived says why",
        refused.length > 0,
        refused.at(-1) ?? "no refusal",
      )
    } finally {
      await close()
    }
  }

  // 2. A budget too small for one request: spent by B's answer, which then
  //    wakes nobody, and the asking thread is told.
  {
    const script = scriptedModel({
      answer: { reply: context => replies(context.at(-1) ?? "") },
    })
    const section = await lanes.sectionHost({
      files: { "a.txt": "a\n" },
      model: { kind: "scripted", script },
      places: placesWith(1),
    })
    const { user, idle, host, close } = section
    try {
      const { a, bName } = await twoThreads(section)
      const end = threadEnd(treeOf(host), a)
      script.use([{ tool: "ask", args: { to: bName, text: "queue or not?" } }])
      await user.send(`Please talk to @${bName} about queues`, at(end), {
        thread: a,
      })
      await idle()
      const inA = said(host, a)
      const answered = inA.findIndex(l => l.startsWith("answer:"))
      check(
        "a spent budget: the answer wakes nobody, and the asking thread is told it was spent",
        answered >= 0 &&
          !inA.slice(answered + 1).some(l => l.includes("A-NOTED")) &&
          inA.some(l => l.includes("agents spent the budget")),
        inA.slice(-4).join(" | "),
      )
    } finally {
      await close()
    }
  }
}
