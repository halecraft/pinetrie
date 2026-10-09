import {
  type CardRecord,
  type CardWidth,
  entryId,
  type NoteColumnId,
  noteColumnIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { type CanvasCard, canvasOf } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  type CardColumn,
  type CardView,
  canvasColumns,
  defaultView,
  openColumns,
  type TaskView,
} from "./canvas-columns.ts"
import { threadOfEntry, tree } from "./fixtures.ts"

const ADA = writerId("ada@x.io")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const N1 = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")

/** `ids` on `TASK`'s canvas, in that order: thread cards and note columns. */
const canvasFor = (
  ids: readonly (ThreadId | NoteColumnId)[],
  widths: ReadonlyMap<string, CardWidth> = new Map(),
): readonly CanvasCard[] =>
  canvasOf(
    ids.map((id, i): CardRecord => {
      const place = {
        kind: "canvas",
        task: TASK,
        order: String(i + 1).padStart(10, "0"),
        width: widths.get(id) ?? 1,
      } as const
      return id.startsWith("n-")
        ? {
            kind: "note-column",
            id: id as NoteColumnId,
            owner: ADA,
            placer: ADA,
            place,
          }
        : {
            kind: "thread",
            id: id as ThreadId,
            owner: ADA,
            placer: ADA,
            place,
          }
    }),
    TASK,
  )

// 1-r -> 2-a -> 3-b is the trunk's thread; 4-c, a branch at 2-a, starts
// another; 5-d, a branch at 3-b, a third (`withThreads`).
const index = tree({
  "1-r": null,
  "2-a": "1-r",
  "3-b": "2-a",
  "4-c": "2-a",
  "5-d": "3-b",
  "6-e": "3-b",
})
const TRUNK = threadOfEntry("1-r")
const C = threadOfEntry("4-c")
const E = threadOfEntry("6-e")

const draw = (canvas: readonly CanvasCard[], view: TaskView) =>
  canvasColumns({ canvas, view, index, lanes: [] })

const shape = (columns: readonly CardColumn[]) =>
  columns.map(c =>
    c.kind === "notes"
      ? ["notes", c.card, c.folded]
      : [c.card === null ? "fresh" : "thread", c.column.key, c.folded],
  )

describe("canvasColumns (ADR-0116)", () => {
  test("every card is a column in the canvas's order, the first alone unfolded by default", () => {
    const canvas = canvasFor([TRUNK, N1, C])
    expect(shape(draw(canvas, defaultView(TRUNK)))).toEqual([
      ["thread", TRUNK, false],
      ["notes", N1, true],
      ["thread", C, true],
    ])
    // Another order is everyone's; folds are the view's.
    const view: TaskView = {
      ...defaultView(null),
      cards: new Map([[C, { unfolded: true, density: "outline" }]]),
    }
    const drawn = draw(canvasFor([C, TRUNK, N1]), view)
    expect(shape(drawn)).toEqual([
      ["thread", C, false],
      ["thread", TRUNK, true],
      ["notes", N1, true],
    ])
    expect(drawn[0]).toMatchObject({
      column: { key: C, anchor: entryId("4-c"), thread: C, density: "outline" },
    })
  })

  test("a card's width is its column's", () => {
    const drawn = draw(
      canvasFor([TRUNK, N1], new Map([[N1, 2]])),
      defaultView(TRUNK),
    )
    expect(drawn.map(c => c.width)).toEqual([1, 2])
  })

  test("a thread whose root this tab does not hold yet is left out", () => {
    const elsewhere = threadIdFor("elsewhere")
    expect(
      shape(draw(canvasFor([elsewhere, TRUNK]), defaultView(elsewhere))),
    ).toEqual([["thread", TRUNK, true]])
  })

  test("a branch not yet sent is drawn just after the thread it forks from, two there in the order they were opened", () => {
    const [F1, F2] = [
      threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1"),
      threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2"),
    ]
    const view: TaskView = {
      ...defaultView(TRUNK),
      fresh: new Map([
        [F2, { at: entryId("3-b") }],
        [F1, { at: entryId("2-a"), prefill: { text: "hi", blank: false } }],
        // Its fork is in a root this tab does not hold.
        [threadIdFor("far"), { at: entryId("9-far") }],
      ]),
    }
    const drawn = draw(canvasFor([TRUNK, N1, C]), view)
    expect(shape(drawn)).toEqual([
      ["thread", TRUNK, false],
      ["fresh", F1, false],
      ["fresh", F2, false],
      ["notes", N1, true],
      ["thread", C, true],
    ])
    expect(drawn[1]).toMatchObject({
      column: {
        key: F1,
        anchor: entryId("2-a"),
        thread: F1,
        fresh: { prefill: { text: "hi", blank: false } },
      },
    })
    // At a fork in a thread on no canvas here: at the end.
    expect(
      shape(
        draw(canvasFor([C, N1]), {
          ...view,
          fresh: new Map([[F1, { at: entryId("2-a") }]]),
        }),
      ).at(-1),
    ).toEqual(["fresh", F1, false])
  })

  test("a branch whose thread has started follows it, and once its card is on the canvas it is drawn once, there", () => {
    const sent: TaskView = {
      ...defaultView(TRUNK),
      fresh: new Map([[E, { at: entryId("3-b"), sendId: "s" }]]),
    }
    const before = draw(canvasFor([TRUNK]), sent)
    expect(before[1]).toMatchObject({
      card: null,
      column: { key: E, anchor: entryId("6-e"), thread: E },
    })
    expect(before[1]?.kind === "thread" && before[1].column.fresh).toBe(
      undefined,
    )
    expect(shape(draw(canvasFor([TRUNK, E]), sent))).toEqual([
      ["thread", TRUNK, false],
      ["thread", E, true],
    ])
  })

  test("openColumns: the thread columns drawn whole, in order", () => {
    const view: TaskView = {
      ...defaultView(TRUNK),
      cards: new Map([
        [TRUNK, { unfolded: true }],
        [C, { unfolded: true }],
      ]),
    }
    expect(
      openColumns(draw(canvasFor([TRUNK, N1, C]), view)).map(c => c.key),
    ).toEqual([TRUNK, C])
  })

  test("a task's view holds no order (ADR-0116)", () => {
    const none = { task: { unfolded: false }, fresh: new Map() }
    const listed: TaskView = {
      ...none,
      cards: new Map(),
      // @ts-expect-error: a view has no list of columns
      order: [TRUNK, C],
    }
    const card: CardView = {
      unfolded: true,
      // @ts-expect-error: nor a card a rank of its own
      order: "a",
    }
    expect([listed, card]).toHaveLength(2)
  })
})
