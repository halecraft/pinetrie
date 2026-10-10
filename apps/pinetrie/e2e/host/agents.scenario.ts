// e2e/host/agents — another thread's agent invited, asked by this thread's
// agent, and its answer waking the asker; then a budget spent, which wakes
// nobody (ADR-0128).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type EntryId,
  projectTranscript,
  ROOT,
  type ThreadId,
  threadEnd,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readNames, readRecords } from "@pinetrie/reads"
import { BUDGET } from "@pinetrie/rules"
import type { Checks } from "../checks.ts"
import { at, BRANCH, START_AGENT, SUITE_CONFIG, treeOf } from "../harness.ts"
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

/** A config file: the suite's, with a budget for agents talking. */
function configWith(budget: number): string {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-agents-config-")),
    "config.json",
  )
  writeFileSync(file, JSON.stringify({ ...SUITE_CONFIG, agents: { budget } }))
  return file
}

/** Two agent threads on one task, A and B; B's name; A's end. */
async function twoThreads(section: SectionHost) {
  const { user, idle, host } = section
  await user.chat("@agent you are A", ROOT, START_AGENT)
  await idle()
  const first = Object.values(treeOf(host).entries).find(
    e => e.parentId === null,
  )?.id as EntryId
  await user.chat("@agent you are B", at(first), BRANCH)
  await idle()
  const tree = treeOf(host)
  const names = readNames(host.session)
  const threads = [...tree.endOf.keys()]
  const a = tree.entries[first]?.thread as ThreadId
  const b = threads.find(t => t !== a) as ThreadId
  return { a, b, bName: names.get(b) ?? "" }
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
      userConfig: configWith(1_000_000),
    })
    const { user, idle, host, close } = section
    try {
      const { a, b, bName } = await twoThreads(section)
      const end = threadEnd(treeOf(host), a)
      script.use([{ tool: "ask", args: { to: bName, text: "queue or not?" } }])
      await user.chat(`Please talk to @${bName} about queues`, at(end), {
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
      userConfig: configWith(1),
    })
    const { user, idle, host, close } = section
    try {
      const { a, bName } = await twoThreads(section)
      const end = threadEnd(treeOf(host), a)
      script.use([{ tool: "ask", args: { to: bName, text: "queue or not?" } }])
      await user.chat(`Please talk to @${bName} about queues`, at(end), {
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
