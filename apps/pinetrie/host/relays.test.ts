import {
  type CanvasId,
  canvasIdFor,
  entryId,
  type RootId,
  rootIdFor,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { NAME, PARTICIPANT, setRecord, WORKFLOW } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Budgets } from "./budgets.ts"
import {
  basics,
  CANVAS_ID,
  placeCanvas,
  placesFor,
  putCanvas,
  putValue,
  RUNS_ANY,
  record,
} from "./fakes.ts"
import { createRelays, readReachableAgents } from "./relays.ts"

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const ADA = writerId("ada@example.com")
const HERE = threadIdFor("01a00000-0000-7000-8000-0000000000a1")
const FOX = threadIdFor("01a00000-0000-7000-8000-0000000000b2")
const OWL = threadIdFor("01a00000-0000-7000-8000-0000000000c3")
const OTHER: CanvasId = canvasIdFor("01a00000-0000-7000-8000-0000000000d4")
const GONE_CANVAS: CanvasId = canvasIdFor(
  "01a00000-0000-7000-8000-0000000000e5",
)
const OTHER_ROOT: RootId = rootIdFor("01a00000-0000-7000-8000-0000000000f6")

/**
 * HERE on the test's canvas; FOX on another open canvas, in a root of its own;
 * OWL on a canvas Ada archived, in that same other root.
 */
function setUp() {
  const b = basics()
  putCanvas(b, HERE)
  putCanvas(b, FOX, OTHER, OTHER_ROOT)
  putCanvas(b, OWL, GONE_CANVAS, OTHER_ROOT)
  putValue(
    b,
    setRecord(WORKFLOW, {
      open: [{ id: DOING, name: "Doing" }],
      archive: { id: DONE, name: "Done" },
    }),
  )
  for (const [canvas, state] of [
    [CANVAS_ID, DOING],
    [OTHER, DOING],
    [GONE_CANVAS, DONE],
  ] as const)
    placeCanvas(b, canvas, state, ADA)
  for (const [lane, name] of [
    [HERE, "sable-meadow"],
    [FOX, "amber-fox"],
    [OWL, "slate-owl"],
  ] as const)
    putValue(b, setRecord(NAME, { lane, name: name as ThreadName, at: 0 }))
  putValue(b, setRecord(PARTICIPANT, { writer: ADA, name: "Ada" }))
  // Every root the relays open, in order: an archived one must not be.
  const opened: RootId[] = []
  const root = b.roots.root
  ;(b.roots as { root: typeof root }).root = async (id: RootId) => {
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
    keeper: { run: step => step(b.roots), track: work => work },
    start: () => {
      throw new Error("no run starts")
    },
    runnable: RUNS_ANY.runnable,
    budgets,
    drain: () => {},
    placesWriter: placesFor(b).placesWriter,
  })
  return { b, relays, opened }
}

describe("other threads' agents in reach", () => {
  test("every named thread on an open canvas, and none on an archived one", () => {
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
      text: "slate-owl's canvas was archived by Ada: it cannot be asked.",
    })
    expect(opened).not.toContain(OTHER_ROOT)
  })

  test("an ask card whose asker was archived since is dropped, its root unopened", async () => {
    const { b, relays, opened } = setUp()
    const ran = await relays.relayCard(b.roots, FOX, {
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
