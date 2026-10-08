import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { TEST_ROOT } from "./fixtures.ts"
import { notesBoardView, notesPlaced } from "./notes-board-view.ts"

const ADA = writerId("ada@x.io")
const note = (id: string, cell: number | null): CardRecord => ({
  id: cardId(id),
  owner: ADA,
  placer: ADA,
  place: {
    kind: "note",
    root: TEST_ROOT,
    at: atEntry(entryId("e-1")),
    lane: null,
    cell,
  },
  carries: { kind: "message", command: null },
  unsent: null,
})

describe("notesBoardView (ADR-0113)", () => {
  test("each note in its cell, gaps kept; a clash or no cell takes the next empty, older first", () => {
    const placed = notesPlaced([
      note("c-3", 2),
      note("c-1", 5),
      note("c-2", 2),
      note("c-4", null),
    ])
    expect(
      [...placed]
        .map(([cell, c]) => [cell, c.id])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [0, "c-3"],
      [1, "c-4"],
      [2, "c-2"],
      [5, "c-1"],
    ])
  })

  test("4 wide, one empty row below the last note; faces are notes'", () => {
    const view = notesBoardView({
      notes: [note("c-1", 5)],
      selected: 5,
      texts: new Map([[cardId("c-1"), "one\ntwo\nthree\nfour"]]),
    })
    expect(view.rows).toBe(3)
    expect(view.cells).toHaveLength(12)
    expect(view.card?.id).toBe("c-1")
    expect(view.cells[5]?.face).toMatchObject({
      tone: "note",
      lines: "one\ntwo\nthree",
      key: null,
    })
  })
})
