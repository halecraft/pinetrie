import { entryId, threadIdFor, writerId } from "@pinetrie/core"
import {
  CANVAS_CAP,
  decodeCanvas,
  decodeCanvasPinned,
  PARTICIPANT,
  setRecord,
} from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import {
  cardIdOfKind,
  type TextCard,
  textCardId,
  UNTICKED,
} from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import { createCanvasContext } from "./canvas.ts"
import type { CardPort } from "./cards.ts"
import {
  basics,
  CANVAS_ID,
  putCanvas,
  putLane,
  putValue,
  record,
  seedPlaces,
  threadRow,
} from "./fakes.ts"

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
  putCanvas(b, LANE)
  putCanvas(b, OTHER)
  const pin: TextCard = {
    kind: "text",
    id: textCardId(cardIdFor("c1")),
    owner: ADA,
    placer: ADA,
    place: { kind: "canvas-pinned", canvas: CANVAS_ID, order: "a" },
    content: { command: null, unsent: null, origin: null },
  }
  seedPlaces(b.places, [
    {
      kind: "write",
      record: {
        kind: "note-column",
        id: NOTES,
        owner: ADA,
        placer: ADA,
        place: {
          kind: "canvas",
          canvas: CANVAS_ID,
          order: "zzzzzzzzzz",
          width: 1,
        },
        content: UNTICKED,
      },
    },
    { kind: "write", record: pin },
  ])
  const cards = record<Pick<CardPort, "hydrate" | "textNow">>({
    hydrate: async () => {},
    textNow: () => "ship it",
  })
  const { readCanvasContext } = createCanvasContext({
    basics: b,
    runs: { docOf: () => b.root },
    cards: cards.port,
  })
  return { b, readCanvasContext }
}

test("a run is told its canvas, its thread marked, and the canvas's pinned cards", async () => {
  const { readCanvasContext } = setUp()
  const [told, pinned] = await readCanvasContext(LANE)
  const list = decodeCanvas(told)
  expect(list?.canvas).toBe(CANVAS_ID)
  expect(list?.lines).toHaveLength(3)
  expect(list?.lines[0]).toMatch(/^thread .* \(this thread\), put by /)
  expect(list?.lines[1]).toMatch(/^thread .*, idle, put by /)
  expect(list?.lines[2]).toBe(
    `note column "Notes" (${NOTES}), no notes, put by Ada`,
  )
  expect(list?.more).toBe(0)
  expect(CANVAS_CAP).toBe(50)
  expect(decodeCanvasPinned(pinned)).toEqual({
    canvas: CANVAS_ID,
    cards: [{ id: cardIdFor("c1"), text: "ship it", by: ADA }],
    retired: [],
  })
})

test("a lane whose thread is in no canvas is told nothing of one", async () => {
  const { readCanvasContext } = setUp()
  expect(await readCanvasContext(threadIdFor("nowhere"))).toEqual([])
})
