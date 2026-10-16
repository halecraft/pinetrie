import {
  type CardRecord,
  type CardWidth,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  type NoteColumnId,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { type CanvasCard, canvasOf, type ThreadOpening } from "@pinetrie/rules"
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
const N1 = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1")

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
            content: NO_CONTENT,
          }
        : {
            kind: "thread",
            id: id as ThreadId,
            owner: ADA,
            placer: ADA,
            place,
            content: NO_CONTENT,
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

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const draw = (
  canvas: readonly CanvasCard[],
  view: TaskView,
  unstarted: ReadonlyMap<ThreadId, ThreadOpening> = new Map(),
  holders: ReadonlyMap<ThreadId, WriterId> = new Map(),
) => canvasColumns({ canvas, view, index, lanes: [], unstarted, holders })

const shape = (columns: readonly CardColumn[]) =>
  columns.map(c =>
    c.kind === "notes"
      ? ["notes", c.card, c.folded]
      : [c.column.mode.kind, c.column.key, c.folded],
  )

describe("canvasColumns", () => {
  test("every card is a column in the canvas's order, the first alone unfolded by default", () => {
    const canvas = canvasFor([TRUNK, N1, C])
    expect(shape(draw(canvas, defaultView(TRUNK)))).toEqual([
      ["bound", TRUNK, false],
      ["notes", N1, true],
      ["bound", C, true],
    ])
    // Another order is everyone's; folds are the view's.
    const view: TaskView = {
      ...defaultView(null),
      cards: new Map([[C, { unfolded: true, density: "outline" }]]),
    }
    const drawn = draw(canvasFor([C, TRUNK, N1]), view)
    expect(shape(drawn)).toEqual([
      ["bound", C, false],
      ["bound", TRUNK, true],
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
    ).toEqual([["bound", TRUNK, true]])
  })

  test("a thread whose parent thread is on no column of the canvas folds its path above it", () => {
    const view: TaskView = {
      ...defaultView(C),
      cards: new Map([
        [C, { unfolded: true }],
        [TRUNK, { unfolded: true }],
      ]),
    }
    const alone = draw(canvasFor([C]), view)[0]
    expect(alone?.kind === "thread" && alone.column.foldAbove).toBe(C)
    const both = draw(canvasFor([TRUNK, C]), view)
    expect(
      both.map(c => (c.kind === "thread" ? c.column.foldAbove : null)),
    ).toEqual([undefined, undefined])
  })

  test("a thread not yet started ends at its fork, and sends as a branch there", () => {
    const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const view: TaskView = {
      ...defaultView(TRUNK),
      cards: new Map([
        [
          F,
          {
            unfolded: true,
            prefill: { text: "hi", blank: false },
            pending: { text: "go" },
          },
        ],
      ]),
    }
    const opened = new Map([[F, { root: ROOT, fork: entryId("3-b") }]])
    const drawn = draw(canvasFor([TRUNK, F, N1]), view, opened)
    expect(shape(drawn)).toEqual([
      ["bound", TRUNK, true],
      ["unstarted", F, false],
      ["notes", N1, true],
    ])
    expect(drawn[1]).toMatchObject({
      kind: "thread",
      card: F,
      column: {
        key: F,
        anchor: entryId("3-b"),
        thread: F,
        mode: {
          kind: "unstarted",
          fork: entryId("3-b"),
          root: ROOT,
          prefill: { text: "hi", blank: false },
          pending: { text: "go" },
        },
      },
    })
    // A new tab's: at its root, with no anchor.
    const [tab] = draw(
      canvasFor([F]),
      defaultView(F),
      new Map([[F, { root: ROOT, fork: null }]]),
    )
    expect(tab).toMatchObject({
      column: { anchor: null, mode: { kind: "unstarted", fork: null } },
    })
    // Not yet started and not opened here, it is left out as a thread not held is.
    expect(draw(canvasFor([F]), defaultView(F))).toEqual([])
    // A proposal's branch you opened starts with its brief; your own prefill wins.
    const proposed = new Map([
      [F, { root: ROOT, fork: entryId("3-b"), draft: "@agent do one" }],
    ])
    const [drafted] = draw(canvasFor([F]), defaultView(F), proposed)
    expect(drafted).toMatchObject({
      column: {
        mode: { prefill: { text: "@agent do one", blank: false } },
      },
    })
    const [mine] = draw(canvasFor([F]), view, proposed)
    expect(mine).toMatchObject({
      column: { mode: { prefill: { text: "hi", blank: false } } },
    })
  })

  test("a thread not yet started in a thread someone else holds says who, drawn without its entries", () => {
    const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const BEA = writerId("bea@x.io")
    const opened = new Map([[F, { root: ROOT, fork: entryId("3-b") }]])
    const held = draw(
      canvasFor([TRUNK, F]),
      defaultView(TRUNK),
      opened,
      new Map([[TRUNK, BEA]]),
    ).find(c => c.kind === "thread" && c.card === F)
    expect(held?.kind === "thread" && held.column.mode).toEqual({
      kind: "unstarted",
      fork: entryId("3-b"),
      root: ROOT,
      held: { thread: TRUNK, by: BEA },
    })
    // Who holds which, as the page reads it: your own held threads are none.
    const card = (holder: typeof BEA): CardRecord => ({
      kind: "thread",
      id: TRUNK,
      owner: ADA,
      placer: ADA,
      place: { kind: "inventory", holder },
      content: NO_CONTENT,
    })
    expect(heldByOthers([card(BEA)], ADA)).toEqual(new Map([[TRUNK, BEA]]))
    expect(heldByOthers([card(ADA)], ADA)).toEqual(new Map())
    const free = draw(canvasFor([TRUNK, F]), defaultView(TRUNK), opened).find(
      c => c.kind === "thread" && c.card === F,
    )
    expect(free?.kind === "thread" && free.column.mode).toEqual({
      kind: "unstarted",
      fork: entryId("3-b"),
      root: ROOT,
    })
  })

  test("a started thread follows its end, bound", () => {
    const [drawn] = draw(canvasFor([E]), defaultView(E))
    expect(drawn).toMatchObject({
      card: E,
      column: { key: E, anchor: entryId("6-e"), thread: E, mode: BOUND },
    })
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

  test("a task's view holds no order", () => {
    const none = { task: { unfolded: false } }
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
