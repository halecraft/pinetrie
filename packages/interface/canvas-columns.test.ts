import {
  type CardRecord,
  type CardWidth,
  type EntryId,
  entryId,
  type NoteColumnId,
  noteColumnIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { type CanvasCard, canvasOf } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  type CardColumn,
  type CardView,
  canvasColumns,
  defaultView,
  heldByOthers,
  openColumns,
  type TaskView,
} from "./canvas-columns.ts"
import { BOUND } from "./columns.ts"
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

const draw = (
  canvas: readonly CanvasCard[],
  view: TaskView,
  forks: ReadonlyMap<ThreadId, EntryId> = new Map(),
  holders: ReadonlyMap<ThreadId, WriterId> = new Map(),
) => canvasColumns({ canvas, view, index, lanes: [], forks, holders })

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

  test("a thread whose parent thread is on no column of the canvas folds its path above its first entry; one whose parent is here does not (ADR-0117)", () => {
    const view: TaskView = {
      ...defaultView(C),
      cards: new Map([
        [C, { unfolded: true }],
        [TRUNK, { unfolded: true }],
      ]),
    }
    const alone = draw(canvasFor([C]), view)[0]
    expect(alone?.kind === "thread" && alone.column.foldAbove).toBe(
      entryId("4-c"),
    )
    const both = draw(canvasFor([TRUNK, C]), view)
    expect(
      both.map(c => (c.kind === "thread" ? c.column.foldAbove : null)),
    ).toEqual([undefined, undefined])
  })

  test("a branch not yet sent in a thread someone else holds says who, and is drawn without that thread's entries; one you hold is drawn whole (ADR-0124)", () => {
    const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const BEA = writerId("bea@x.io")
    const view: TaskView = {
      ...defaultView(TRUNK),
      fresh: new Map([[F, { at: entryId("3-b") }]]),
    }
    const held = draw(
      canvasFor([TRUNK]),
      view,
      new Map(),
      new Map([[TRUNK, BEA]]),
    ).find(c => c.kind === "thread" && c.card === null)
    expect(held?.kind === "thread" && held.column.mode).toEqual({
      kind: "fresh",
      held: { thread: TRUNK, by: BEA },
    })
    // Who holds which, as the page reads it: your own held threads are none.
    const card = (holder: typeof BEA): CardRecord => ({
      kind: "thread",
      id: TRUNK,
      owner: ADA,
      placer: ADA,
      place: { kind: "inventory", holder },
    })
    expect(heldByOthers([card(BEA)], ADA)).toEqual(new Map([[TRUNK, BEA]]))
    expect(heldByOthers([card(ADA)], ADA)).toEqual(new Map())
    const free = draw(canvasFor([TRUNK]), view).find(
      c => c.kind === "thread" && c.card === null,
    )
    expect(free?.kind === "thread" && free.column.mode).toEqual({
      kind: "fresh",
    })
  })

  test("a copy before its first send ends at its fork, and sends as a branch there (ADR-0117)", () => {
    const copy = threadIdFor("copy")
    const [drawn] = draw(
      canvasFor([copy]),
      defaultView(copy),
      new Map([[copy, entryId("3-b")]]),
    )
    expect(drawn).toMatchObject({
      kind: "thread",
      card: copy,
      column: {
        key: copy,
        anchor: entryId("3-b"),
        thread: copy,
        mode: { kind: "copy", fork: entryId("3-b") },
      },
    })
    // Without its record's fork, it is left out as a thread not held is.
    expect(draw(canvasFor([copy]), defaultView(copy))).toEqual([])
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
        mode: { kind: "fresh", prefill: { text: "hi", blank: false } },
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
      column: { key: E, anchor: entryId("6-e"), thread: E, mode: BOUND },
    })
    expect(before[1]?.kind === "thread" && before[1].column.mode).toEqual(BOUND)
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
