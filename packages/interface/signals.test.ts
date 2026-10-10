import {
  type CardId,
  type CardRecord,
  type EntryLike,
  entryId,
  NO_CONTENT,
  noteColumnIdFor,
  ROOT,
  rootIdFor,
  type TaskId,
  type TextCard,
  type TreeIndex,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { threadCardOf } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import { defaultView } from "./canvas-columns.ts"
import { entry, indexOf } from "./fixtures.ts"
import { hereOfColumn, initialLayout, type Layout } from "./layout.ts"
import { holdsText, ownCards, unsentSignals, withFilled } from "./signals.ts"
import { tasksOf } from "./tasks.ts"

const _TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root this tab does not hold: its root entry is f1. */
const _FAR_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000f")

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const said = (id: string, parentId: string | null): EntryLike =>
  entry(id, parentId, { role: "user", content: `text of ${id}` })
/** Two roots: e1 -> e2, and g1. */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexOf([said("e1", null), said("e2", "e1"), said("g1", null), ...more])
/** The thread an entry of the fixtures is in; `gone` is in none. */
const threadOf = (at: string) =>
  at.startsWith("e")
    ? threadIdFor("e1")
    : at === "g1"
      ? threadIdFor("g1")
      : at.startsWith("f")
        ? FAR_THREAD
        : threadIdFor(at)
const atEnd = (id: string, at: string, owner = ADA): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner,
  placer: owner,
  place: {
    kind: "composing",
    thread: threadOf(at),
  },
  content: { command: null, unsent: null, origin: null },
})
const fresh = (id: string, column: string): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: ADA,
  placer: ADA,
  place: { kind: "fresh", column, root: TEST_ROOT, task: TEST_TASK, at: ROOT },
  content: { command: null, unsent: null, origin: null },
})
/** Each root's task, one a root (ADR-0116): e1's, g1's and the far f1's. */
const K = (root: string) => taskIdFor(root)
/** A note column on g1's task's canvas. */
const NOTES = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
/** Thread `far` is recorded in the far root. */
const FAR_THREAD = threadIdFor("far")
const tasks = tasksOf({
  known: ["e1", "g1", "f1"].map(K),
  cards: [
    ...["e1", "g1", "f1"].map(r =>
      threadCardOf({
        thread: r === "f1" ? FAR_THREAD : threadIdFor(r),
        task: K(r),
        by: ADA,
        cards: [],
      }),
    ),
    {
      kind: "note-column",
      id: NOTES,
      owner: ADA,
      placer: ADA,
      place: { kind: "canvas", task: K("g1"), order: "z", width: 1 },
      content: NO_CONTENT,
    },
  ],
  threads: new Map(),
}).index
/** A branch's column key in e1's task, and one in g1's: the threads they minted. */
const BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const G_BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
const NEW_TAB = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f3")
/** e1's task open, holding a branch; a new tab; g1's task closed, with a branch. */
const layout: Layout = {
  ...initialLayout(),
  open: [K("e1")],
  tasks: new Map([
    [
      K("e1"),
      {
        ...defaultView(null),
        fresh: new Map([[BRANCH, { at: entryId("e1") }]]),
      },
    ],
    [
      K("g1"),
      {
        ...defaultView(null),
        fresh: new Map([[G_BRANCH, { at: entryId("g1") }]]),
      },
    ],
  ]),
  newTabs: [
    { key: NEW_TAB, anchor: null, thread: NEW_TAB, mode: { kind: "fresh" } },
  ],
}
const marks = (
  cards: readonly CardRecord[],
  filled: readonly string[] = cards.map(c => c.id),
  over: { layout?: Layout; index?: TreeIndex; archived?: Set<TaskId> } = {},
) =>
  unsentSignals({
    mine: ownCards(ADA, cards),
    filled: new Set(filled.map(textCardId)),
    layout: over.layout ?? layout,
    archived: over.archived ?? new Set(),
    tasks,
    index: over.index ?? tree(),
  })
const sets = (m: ReturnType<typeof marks>) => ({
  tasks: [...m.tasks],
  newTabs: [...m.newTabs],
  ends: [...m.ends],
  elsewhere: m.elsewhere,
})

test("holdsText: what would make a card, a bare @agent nothing", () => {
  expect(holdsText("fix it")).toBe(true)
  expect(holdsText("  \n")).toBe(false)
  expect(holdsText("@agent ")).toBe(false)
  expect(holdsText("@agent fix it")).toBe(true)
})

test("withFilled: the same set unless the card flips", () => {
  const C: CardId = textCardId("c")
  const none: ReadonlySet<CardId> = new Set()
  const some: ReadonlySet<CardId> = new Set([C])
  expect(withFilled(some, C, true)).toBe(some)
  expect(withFilled(none, C, false)).toBe(none)
  expect([...withFilled(none, C, true)]).toEqual([C])
  expect([...withFilled(some, C, false)]).toEqual([])
})

test("hereOfColumn: a new tab's column, a branch of a task's open or closed, or none", () => {
  expect(hereOfColumn(layout, NEW_TAB)).toEqual({ kind: "new", key: NEW_TAB })
  expect(hereOfColumn(layout, BRANCH)).toEqual({
    kind: "task",
    task: K("e1"),
  })
  expect(hereOfColumn(layout, G_BRANCH)).toEqual({
    kind: "task",
    task: K("g1"),
  })
  expect(hereOfColumn(layout, "elsewhere")).toBeUndefined()
})

describe("unsentSignals", () => {
  test("your message marks its task and its thread's end", () => {
    expect(sets(marks([atEnd("c", "e2")]))).toEqual({
      tasks: [K("e1")],
      newTabs: [],
      ends: ["e2"],
      elsewhere: false,
    })
  })

  test("a note you own marks its note column's task, and no thread's end (ADR-0116)", () => {
    const note: CardRecord = {
      ...atEnd("c", "e2"),
      place: { kind: "note", column: NOTES, order: "a" },
    }
    // g1's task is closed: ▦ is marked.
    expect(sets(marks([note]))).toEqual({
      tasks: [K("g1")],
      newTabs: [],
      ends: [],
      elsewhere: true,
    })
  })

  test("a pinned card marks nothing: it is a thread's direction, not unsent work", () => {
    const pinned: CardRecord = {
      ...atEnd("p", "e2"),
      // In a root this tab does not hold, which your message would mark.
      place: {
        kind: "pinned",
        thread: threadOf("e2"),
        order: "a",
      },
    }
    expect(sets(marks([pinned]))).toEqual({
      tasks: [],
      newTabs: [],
      ends: [],
      elsewhere: false,
    })
  })

  test("your message in a root this tab does not hold marks its thread's task, with no end (ADR-0063)", () => {
    const m = marks([atEnd("c", "f2")])
    expect(sets(m).tasks).toEqual([K("f1")])
    expect(sets(m).ends).toEqual([])
    expect(m.elsewhere).toBe(true)
  })

  test("it follows its thread as the thread grows", () => {
    const grown = tree(said("e3", "e2"))
    expect([
      ...marks([atEnd("c", "e2")], ["c"], { index: grown }).ends,
    ]).toEqual(["e3"])
  })

  test("a fresh card marks the tab its column is in", () => {
    expect(sets(marks([fresh("c", BRANCH), fresh("d", NEW_TAB)]))).toEqual({
      tasks: [K("e1")],
      newTabs: [NEW_TAB],
      ends: [],
      elsewhere: false,
    })
  })

  test("a fresh card in a column this layout lacks marks nothing", () => {
    expect(sets(marks([fresh("c", "elsewhere")])).tasks).toEqual([])
  })

  test("only your cards, only with text, only where their place still is", () => {
    const none = { tasks: [], newTabs: [], ends: [], elsewhere: false }
    expect(sets(marks([atEnd("c", "e2", BEA)]))).toEqual(none)
    expect(sets(marks([atEnd("c", "e2")], []))).toEqual(none)
    expect(sets(marks([atEnd("c", "gone")]))).toEqual(none)
  })

  test("elsewhere: a marked task you closed", () => {
    expect(marks([atEnd("c", "g1")]).elsewhere).toBe(true)
    expect(marks([fresh("c", G_BRANCH)]).elsewhere).toBe(true)
    const closed = { ...layout, open: [] }
    expect(marks([atEnd("c", "e2")], ["c"], { layout: closed }).elsewhere).toBe(
      true,
    )
  })

  test("an archived task marks its row, never ▦", () => {
    const m = marks([atEnd("c", "g1")], ["c"], {
      archived: new Set([K("g1")]),
    })
    expect([...m.tasks]).toEqual([K("g1")])
    expect(m.elsewhere).toBe(false)
  })
})
