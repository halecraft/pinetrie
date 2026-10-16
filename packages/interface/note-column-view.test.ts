import {
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  NO_CONTENT,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import {
  type CardOnCanvas,
  cardsOnCanvas,
  NEW_NOTES_TITLE,
} from "@pinetrie/rules"
import { expect, test } from "vitest"
import { noteColumnsOf } from "./note-column-view.ts"

const ADA = writerId("ada@x.io")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const [A, B] = [threadIdFor("a"), threadIdFor("b")]
const [N1, N2] = [
  cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1"),
  cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a2"),
]
const cardsFor = (...ids: (typeof A | typeof N1)[]): readonly CardOnCanvas[] =>
  cardsOnCanvas(
    ids.map((id, i): CardRecord => {
      const place = {
        kind: "canvas",
        canvas: CANVAS,
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
            content: NO_CONTENT,
          }
        : {
            kind: "thread",
            id: id === A ? A : B,
            owner: ADA,
            placer: ADA,
            place,
            content: NO_CONTENT,
          }
    }),
    CANVAS,
  )

test("noteColumnsOf: each note column in the canvas's order, its title or Notes, its notes in order", () => {
  const note = (id: string, column: typeof N1, order: string): CardRecord => ({
    kind: "text",
    id: textCardId(id),
    owner: ADA,
    placer: ADA,
    place: { kind: "note", column, order },
    content: { command: null, unsent: null, origin: null },
  })
  const n1 = note(cardIdFor("c1"), N1, "b")
  const n2 = note(cardIdFor("c2"), N1, "a")
  const views = noteColumnsOf({
    onCanvas: cardsFor(A, N2, N1),
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
