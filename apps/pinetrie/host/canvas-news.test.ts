import {
  type CardRecord,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  runId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import { readPlaces } from "@pinetrie/reads"
import { decodeCanvasFact } from "@pinetrie/rules"
import { beginRun } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { createCanvasNews } from "./canvas-news.ts"
import { basics, putLane, putTask, record, TASK_ID } from "./fakes.ts"

const LANE = threadIdFor("0123456789abcdef")
const BEA = writerId("bea@x.io")
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)

test("a card added to a task's canvas is told to its running threads, as a steer (ADR-0116)", async () => {
  const b = basics()
  putLane(b, LANE, entryId("p-1"))
  putTask(b, LANE)
  const steered: unknown[] = []
  const handle = record<ThreadLaneHandle>({
    steer: async message => {
      steered.push(message)
      return { kind: "ok" }
    },
  }).port
  const news = createCanvasNews({
    basics: b,
    agent: { lane: () => handle },
    keeper: { run: f => f() },
  })
  const before = readPlaces(b.places)
  const column: CardRecord = {
    kind: "note-column",
    id: NOTES,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", task: TASK_ID, order: "zzzzzzzzzz", width: 1 },
    content: NO_CONTENT,
  }
  const change = {
    before,
    after: [...before, column],
    cause: { kind: "move", by: BEA },
  } as const
  // Idle: told at its next run's start, in the canvas list.
  news.changed(change)
  await new Promise(r => setTimeout(r, 0))
  expect(steered).toEqual([])
  beginRun(b.live, LANE, runId("r-1"))
  news.changed(change)
  await new Promise(r => setTimeout(r, 0))
  expect(steered.map(m => decodeCanvasFact(m))).toEqual([
    {
      task: TASK_ID,
      by: BEA,
      byName: "bea",
      title: 'note column "Notes"',
      change: "added",
    },
  ])
})
