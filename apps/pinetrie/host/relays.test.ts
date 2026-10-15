import {
  entryId,
  type RootId,
  rootIdFor,
  type TaskId,
  type ThreadId,
  type ThreadName,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import { NAME, PARTICIPANT, setRecord, WORKFLOW } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Budgets } from "./budgets.ts"
import {
  basics,
  placesFor,
  placeTask,
  putTask,
  putValue,
  RUNS_ANY,
  record,
  TASK_ID,
} from "./fakes.ts"
import { createRelays, readReachableAgents } from "./relays.ts"

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const ADA = writerId("ada@example.com")
const HERE = threadIdFor("01a00000-0000-7000-8000-0000000000a1")
const FOX = threadIdFor("01a00000-0000-7000-8000-0000000000b2")
const OWL = threadIdFor("01a00000-0000-7000-8000-0000000000c3")
const OTHER: TaskId = taskIdFor("01a00000-0000-7000-8000-0000000000d4")
const GONE_TASK: TaskId = taskIdFor("01a00000-0000-7000-8000-0000000000e5")
const OTHER_ROOT: RootId = rootIdFor("01a00000-0000-7000-8000-0000000000f6")

/**
 * HERE on the test's task; FOX on another open task, in a root of its own;
 * OWL on a task Ada archived, in that same other root.
 */
function setUp() {
  const b = basics()
  putTask(b, HERE)
  putTask(b, FOX, OTHER, OTHER_ROOT)
  putTask(b, OWL, GONE_TASK, OTHER_ROOT)
  putValue(
    b,
    setRecord(WORKFLOW, {
      open: [{ id: DOING, name: "Doing" }],
      archive: { id: DONE, name: "Done" },
    }),
  )
  for (const [task, state] of [
    [TASK_ID, DOING],
    [OTHER, DOING],
    [GONE_TASK, DONE],
  ] as const)
    placeTask(b, task, state, ADA)
  for (const [lane, name] of [
    [HERE, "sable-meadow"],
    [FOX, "amber-fox"],
    [OWL, "slate-owl"],
  ] as const)
    putValue(b, setRecord(NAME, { lane, name: name as ThreadName, at: 0 }))
  putValue(b, setRecord(PARTICIPANT, { writer: ADA, name: "Ada" }))
  // Every root the relays open, in order: an archived one must not be.
  const opened: RootId[] = []
  const root = b.docs.root.bind(b.docs)
  b.docs.root = async (id: RootId) => {
    opened.push(id)
    return root(id)
  }
  const budgets = record<Budgets>({
    runBudget: () => ({ key: entryId("m"), spends: true, by: ADA }),
    ensure: async () => ({
      message: entryId("m"),
      thread: HERE,
      by: ADA,
      limit: 1,
      spent: 0,
      over: false,
    }),
    spent: () => false,
  }).port
  const relays = createRelays({
    basics: b,
    keeper: { run: step => step(), track: work => work },
    agent: record<Pick<Agent, "lane">>().port,
    scribe: record<Pick<Scribe, "appendToTree">>().port,
    start: () => {
      throw new Error("no run starts")
    },
    runnable: RUNS_ANY.runnable,
    budgets,
    piSetup: record<Pick<PiSetup, "complete" | "skill">>().port,
    drain: () => {},
    placesWriter: placesFor(b).placesWriter,
  })
  return { b, relays, opened }
}

describe("other threads' agents in reach", () => {
  test("every named thread on an open task, and none on an archived one", () => {
    const { b } = setUp()
    expect(readReachableAgents(b).map(t => t.name)).toEqual([
      "sable-meadow",
      "amber-fox",
    ])
  })

  test("an ask of an archived thread says why, and never opens its root", async () => {
    const { relays, opened } = setUp()
    const answer = await relays.ask(HERE, "slate-owl", "anything?")
    expect(answer).toMatchObject({
      isError: true,
      text: "slate-owl's task was archived by Ada: it cannot be asked.",
    })
    expect(opened).not.toContain(OTHER_ROOT)
  })

  test("an ask card whose asker was archived since is dropped, its root unopened", async () => {
    const { relays, opened } = setUp()
    const ran = await relays.relayCard(FOX, {
      from: OWL as ThreadId,
      fromName: "slate-owl",
      source: entryId("s"),
      asker: { kind: "agent", thread: OWL },
      askerName: "slate-owl",
      text: "anything?",
      budget: entryId("m"),
      by: ADA,
    })
    expect(ran).toBe("next")
    expect(opened).toEqual([])
  })
})
