import {
  type CanvasId,
  canvasIdFor,
  type QueuedFact,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { readPlaces } from "@pinetrie/reads"
import {
  MARK,
  PARTICIPANT,
  queuedOn,
  setRecord,
  WORKFLOW,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  applyWrites,
  basics,
  CANVAS_ID,
  hostRoots,
  placeCanvas,
  placesFor,
  putCanvas,
  putValue,
  ROOT_ID,
  stepKeeper,
  writeDirectory,
} from "./fakes.ts"
import { createLater } from "./later.ts"

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const ADA = writerId("ada@example.com")
const HERE = threadIdFor("01a00000-0000-7000-8000-0000000000a1")
const AWAY = threadIdFor("01a00000-0000-7000-8000-0000000000b2")
const SHUT: CanvasId = canvasIdFor("01a00000-0000-7000-8000-0000000000d4")

/** HERE on an open canvas; AWAY on one Ada archived. */
function setUp() {
  const b = basics()
  putCanvas(b, HERE)
  putCanvas(b, AWAY, SHUT)
  putValue(
    b,
    setRecord(WORKFLOW, {
      open: [{ id: DOING, name: "Doing" }],
      archive: { id: DONE, name: "Done" },
    }),
  )
  placeCanvas(b, CANVAS_ID, DOING, ADA)
  placeCanvas(b, SHUT, DONE, ADA)
  putValue(b, setRecord(PARTICIPANT, { writer: ADA, name: "Ada" }))
  const written: unknown[] = []
  const keeper = stepKeeper(b, {
    records: {
      writeValues: async writes => {
        written.push(...writes)
        applyWrites(b, writes)
      },
    },
  })
  const drained: string[] = []
  const later = createLater({
    basics: b,
    keeper,
    placesWriter: placesFor(b).placesWriter,
    drain: lane => drained.push(lane),
  })
  return { b, keeper, later, written, drained }
}

const round = (lane: typeof HERE): QueuedFact => ({
  kind: "round",
  lane,
  line: "over to you",
  by: ADA,
})

const facts = (b: ReturnType<typeof basics>, lane: typeof HERE) =>
  queuedOn(readPlaces(b.places), lane).map(c => c.kind)

describe("a late write of the host's", () => {
  test("in an archived canvas writes nothing, plans nothing, and says why", async () => {
    const { b, later, written } = setUp()
    let planned = false
    await later.step({ kind: "thread", thread: AWAY }, "a digest", () => {
      planned = true
      return { facts: [round(AWAY)] }
    })
    expect([planned, written, facts(b, AWAY)]).toEqual([false, [], []])
    expect(b.lines).toEqual([
      expect.stringContaining("a digest not written: archived by Ada"),
    ])
  })

  test("queues each fact on its lane, and asks for the lane's drain", async () => {
    const { b, later, drained } = setUp()
    await later.step({ kind: "thread", thread: HERE }, "a round", () => ({
      facts: [round(HERE)],
    }))
    expect([facts(b, HERE), drained]).toEqual([["fact"], [HERE]])
  })

  test("drops a fact for a lane out of reach, and writes the rest", async () => {
    const { b, later } = setUp()
    await later.step({ kind: "thread", thread: HERE }, "answers", () => ({
      facts: [round(AWAY), round(HERE)],
    }))
    expect([facts(b, AWAY), facts(b, HERE)]).toEqual([[], ["fact"]])
    expect(b.lines).toEqual([
      expect.stringContaining("a round fact not written: archived by Ada"),
    ])
  })

  test("to an archived canvas, a title's, writes nothing", async () => {
    const { later, written } = setUp()
    await later.step({ kind: "canvas", canvas: SHUT }, "a title", () => ({
      records: [setRecord(MARK, { canvas: SHUT, title: "x", by: ADA, at: 1 })],
    }))
    expect(written).toEqual([])
  })

  test("is queued before `step` returns, ahead of a step queued after it", async () => {
    const { keeper, later } = setUp()
    const order: string[] = []
    const late = later.step({ kind: "thread", thread: HERE }, "a step", () => {
      order.push("late")
      return null
    })
    const next = keeper.run(async () => {
      order.push("next")
    })
    await Promise.all([late, next])
    expect(order).toEqual(["late", "next"])
  })

  test("asked outside the keeper is gated where its thread is when it answers", async () => {
    const { b, later } = setUp()
    const answer = Promise.withResolvers<string>()
    const held = new Set<string>()
    const done = later.outside({
      scope: { kind: "thread", thread: HERE },
      what: "a round",
      request: () => answer.promise,
      plan: () => ({ facts: [round(HERE)] }),
      failed: error => {
        throw error
      },
      held: { set: held, key: "a" },
    })
    expect(held.has("a")).toBe(true)
    // Its canvas is archived while the model writes.
    placeCanvas(b, CANVAS_ID, DONE, ADA, 2)
    answer.resolve("people: over to you")
    await done
    expect([facts(b, HERE), held.size]).toEqual([[], 0])
  })

  test("asked outside the keeper, a failure goes to `failed` and frees its key", async () => {
    const { later } = setUp()
    const failures: unknown[] = []
    const held = new Set<string>()
    await later.outside({
      scope: { kind: "thread", thread: HERE },
      what: "a round",
      request: async () => {
        throw new Error("no key")
      },
      plan: () => null,
      failed: error => failures.push(error),
      held: { set: held, key: "a" },
    })
    expect([failures.length, held.size]).toEqual([1, 0])
  })
})

test("a late step into a thread loads its root before its plan, so pi may write there", async () => {
  const b = basics()
  putCanvas(b, HERE)
  writeDirectory(b)
  const { keeper, roots } = hostRoots({ session: b.session })
  const later = createLater({
    basics: b,
    keeper,
    placesWriter: placesFor(b).placesWriter,
    drain: () => {},
  })
  let handed = false
  await later.step({ kind: "thread", thread: HERE }, "a test", async () => {
    handed = (await roots.pi.root(ROOT_ID).catch(() => null)) !== null
    return null
  })
  expect(handed).toBe(true)
})
