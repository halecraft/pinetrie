import {
  type CardId,
  type CardRecord,
  cardIdOfKind,
  type EntryLike,
  NO_CONTENT,
  rootIdFor,
  type TaskId,
  type TextCard,
  type ThreadId,
  type TreeIndex,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { threadCardOf } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import { entry, indexOf } from "./fixtures.ts"
import { initialLayout, type Layout } from "./layout.ts"
import { holdsText, ownCards, unsentSignals, withFilled } from "./signals.ts"
import { tasksOf } from "./tasks.ts"

const _TEST_THREAD = threadIdFor("e")
const _TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
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
/** Your message at a thread not yet started (ADR-0126): it has no end. */
const fresh = (id: string, thread: ThreadId): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: ADA,
  placer: ADA,
  place: { kind: "composing", thread },
  content: { command: null, unsent: null, origin: null },
})
/** Each root's task, one a root (ADR-0116): e1's, g1's and the far f1's. */
const K = (root: string) => taskIdFor(root)
/** A note column on g1's task's canvas. */
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
/** Thread `far` is recorded in the far root. */
const FAR_THREAD = threadIdFor("far")
/** A branch not yet started on e1's canvas, and one on g1's (ADR-0126). */
const BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const G_BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
const tasks = tasksOf({
  known: ["e1", "g1", "f1"].map(K),
  cards: [
    ...(
      [
        [threadIdFor("e1"), "e1"],
        [threadIdFor("g1"), "g1"],
        [FAR_THREAD, "f1"],
        [BRANCH, "e1"],
        [G_BRANCH, "g1"],
      ] as const
    ).map(
      ([thread, r], i) =>
        ({
          ...threadCardOf({ thread, task: K(r), by: ADA, cards: [] }),
          place: { kind: "canvas", task: K(r), order: `a${i}`, width: 1 },
        }) as CardRecord,
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
/** e1's task open; g1's closed. */
const layout: Layout = { ...initialLayout(), open: [K("e1")] }
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

describe("unsentSignals", () => {
  test("your message marks its task and its thread's end", () => {
    expect(sets(marks([atEnd("c", "e2")]))).toEqual({
      tasks: [K("e1")],
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

  test("your message at a thread not yet started marks its task, with no end (ADR-0126)", () => {
    expect(sets(marks([fresh("c", BRANCH)]))).toEqual({
      tasks: [K("e1")],
      ends: [],
      elsewhere: false,
    })
  })

  test("your message at a thread on no canvas marks nothing", () => {
    expect(sets(marks([fresh("c", threadIdFor("elsewhere"))])).tasks).toEqual(
      [],
    )
  })

  test("only your cards, only with text, only where their place still is", () => {
    const none = { tasks: [], ends: [], elsewhere: false }
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
