import {
  type CardRecord,
  noteColumnIdFor,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { type CanvasCard, canvasOf, NEW_NOTES_TITLE } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { noteColumnsOf, stripItems } from "./note-column-view.ts"

const ADA = writerId("ada@x.io")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const [A, B] = [threadIdFor("a"), threadIdFor("b")]
const [N1, N2] = [
  noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
  noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a2"),
]
const canvas = (...ids: (typeof A | typeof N1)[]): readonly CanvasCard[] =>
  canvasOf(
    ids.map((id, i): CardRecord => {
      const place = {
        kind: "canvas",
        task: TASK,
        order: String(i).padStart(10, "0"),
        width: 1,
      } as const
      return id.startsWith("n-")
        ? {
            kind: "note-column",
            id: N1 === id ? N1 : N2,
            owner: ADA,
            placer: ADA,
            place,
          }
        : {
            kind: "thread",
            id: id === A ? A : B,
            owner: ADA,
            placer: ADA,
            place,
          }
    }),
    TASK,
  )

describe("stripItems (ADR-0116)", () => {
  test("each note column just after the last open column whose thread comes before it on the canvas", () => {
    expect(
      stripItems([{ thread: A }, { thread: B }], canvas(A, N1, B, N2)),
    ).toEqual([
      { kind: "thread", position: 0 },
      { kind: "notes", column: N1 },
      { kind: "thread", position: 1 },
      { kind: "notes", column: N2 },
    ])
  })
  test("one before every open thread goes first; a fresh column is passed over; the tab's order of thread columns is kept", () => {
    expect(
      stripItems([{ thread: B }, {}, { thread: A }], canvas(N1, A, N2, B)),
    ).toEqual([
      { kind: "notes", column: N1 },
      { kind: "thread", position: 0 },
      { kind: "thread", position: 1 },
      { kind: "thread", position: 2 },
      { kind: "notes", column: N2 },
    ])
  })
})

test("noteColumnsOf: each note column in the canvas's order, its title or Notes, its notes in order", () => {
  const note = (id: string, column: typeof N1, order: string): CardRecord => ({
    kind: "text",
    id: textCardId(id),
    owner: ADA,
    placer: ADA,
    place: { kind: "note", column, order },
    carries: { kind: "message", command: null },
    unsent: null,
  })
  const n1 = note("c0000000-0000-7000-8000-000000000001", N1, "b")
  const n2 = note("c0000000-0000-7000-8000-000000000002", N1, "a")
  const views = noteColumnsOf({
    canvas: canvas(A, N2, N1),
    cards: [n1, n2],
    titles: new Map([[N1, { column: N1, title: "Ideas", by: ADA, at: 1 }]]),
  })
  expect(
    views.map(v => [v.column, v.title, v.titled, v.notes.map(n => n.id)]),
  ).toEqual([
    [N2, NEW_NOTES_TITLE, null, []],
    [N1, "Ideas", "Ideas", [n2.id, n1.id]],
  ])
})
