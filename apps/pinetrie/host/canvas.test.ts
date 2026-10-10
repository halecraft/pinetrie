import {
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  type TextCard,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import {
  CANVAS_CAP,
  decodeCanvas,
  decodeTaskPinned,
  PARTICIPANT,
  setRecord,
} from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { createTaskContext } from "./canvas.ts"
import type { CardPort } from "./cards.ts"
import {
  basics,
  putLane,
  putTask,
  putValue,
  record,
  TASK_ID,
  threadRow,
} from "./fakes.ts"
import { applyPlaceSteps } from "./places.ts"

const LANE = threadIdFor("0123456789abcdef")
const OTHER = threadIdFor("fedcba9876543210")
const ADA = writerId("ada@x.io")
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)

function setUp() {
  const b = basics()
  writeEntry(b.root, threadRow("e-1", null, LANE))
  putLane(b, LANE, entryId("e-1"))
  putValue(b, setRecord(PARTICIPANT, { writer: ADA, name: "Ada" }))
  putTask(b, LANE)
  putTask(b, OTHER)
  const pin: TextCard = {
    kind: "text",
    id: textCardId(cardIdFor("c1")),
    owner: ADA,
    placer: ADA,
    place: { kind: "task-pinned", task: TASK_ID, order: "a" },
    content: { command: null, unsent: null, origin: null },
  }
  applyPlaceSteps(b.places, [
    {
      kind: "write",
      record: {
        kind: "note-column",
        id: NOTES,
        owner: ADA,
        placer: ADA,
        place: { kind: "canvas", task: TASK_ID, order: "zzzzzzzzzz", width: 1 },
        content: NO_CONTENT,
      },
    },
    { kind: "write", record: pin },
  ])
  const cards = record<Pick<CardPort, "hydrate" | "textNow">>({
    hydrate: async () => {},
    textNow: () => "ship it",
  })
  const { readTaskContext } = createTaskContext({
    basics: b,
    cards: cards.port,
  })
  return { b, readTaskContext }
}

test("a run is told its task's canvas, its thread marked, and the cards pinned to the task, each as an entry of its own (ADR-0116)", async () => {
  const { readTaskContext } = setUp()
  const [canvas, pinned] = await readTaskContext(LANE)
  const list = decodeCanvas(canvas)
  expect(list?.task).toBe(TASK_ID)
  expect(list?.lines).toHaveLength(3)
  expect(list?.lines[0]).toMatch(/^thread .* \(this thread\), put by /)
  expect(list?.lines[1]).toMatch(/^thread .*, idle, put by /)
  expect(list?.lines[2]).toBe('note column "Notes", 0 notes, put by Ada')
  expect(list?.more).toBe(0)
  expect(CANVAS_CAP).toBe(50)
  expect(decodeTaskPinned(pinned)).toEqual({
    task: TASK_ID,
    cards: [{ id: cardIdFor("c1"), text: "ship it", by: ADA }],
    retired: [],
  })
})

test("a lane whose thread is in no task is told nothing of one", async () => {
  const { readTaskContext } = setUp()
  expect(await readTaskContext(threadIdFor("nowhere"))).toEqual([])
})
