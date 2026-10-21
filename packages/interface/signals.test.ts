import {
  type CanvasId,
  canvasIdFor,
  entryId,
  rootIdFor,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { landedThreadCard } from "@pinetrie/rules/fixtures"
import {
  type CardId,
  type CardRecord,
  cardIdOfKind,
  type EntryLike,
  type TextCard,
  type TreeIndex,
  textCardId,
  UNTICKED,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import type { LEVELS, Status } from "./attention.ts"
import { canvasesWith, entry, indexEntries } from "./fixtures.ts"
import { initialLayout, type Layout } from "./layout.ts"
import {
  elsewhereWords,
  holdsText,
  ownCards,
  type Signal,
  signalWords,
  statusSignal,
  statusWord,
  statusWords,
  unsentSignals,
  withFilled,
} from "./signals.ts"

/** Every signal: a key missing here, or one that is no signal, does not compile. */
const EVERY_SIGNAL: Record<Signal, true> = {
  unsent: true,
  accepted: true,
  running: true,
  "worth-a-read": true,
  ready: true,
  conflicts: true,
  "needs-you": true,
  done: true,
}
const SIGNALS = Object.keys(EVERY_SIGNAL) as Signal[]

const _TEST_THREAD = threadIdFor("e")
const _TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root this tab does not hold: its root entry is f1. */
const _FAR_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000f")

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const said = (id: string, parentId: string | null): EntryLike =>
  entry(id, parentId, { role: "user", content: `text of ${id}` })
/** Two roots: e1 -> e2, and g1. */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexEntries([said("e1", null), said("e2", "e1"), said("g1", null), ...more])
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
/** Your message at a thread not yet started: it has no end. */
const atUnstarted = (id: string, thread: ThreadId): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: ADA,
  placer: ADA,
  place: { kind: "composing", thread },
  content: { command: null, unsent: null, origin: null },
})
/** Each root's canvas, one a root: e1's, g1's and the far f1's. */
const K = (root: string) => canvasIdFor(root)
/** A note column on g1's canvas. */
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
/** Thread `far` is recorded in the far root. */
const FAR_THREAD = threadIdFor("far")
/** A branch not yet started on e1's canvas, and one on g1's. */
const BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const G_BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
const canvases = canvasesWith({
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
          ...landedThreadCard({ thread, canvas: K(r), by: ADA, cards: [] }),
          place: { kind: "canvas", canvas: K(r), order: `a${i}`, width: 1 },
        }) as CardRecord,
    ),
    {
      kind: "note-column",
      id: NOTES,
      owner: ADA,
      placer: ADA,
      place: { kind: "canvas", canvas: K("g1"), order: "z", width: 1 },
      content: UNTICKED,
    },
  ],
  threads: new Map(),
}).index
/** e1's canvas open; g1's closed. */
const layout: Layout = { ...initialLayout(), open: [K("e1")] }
const marks = (
  cards: readonly CardRecord[],
  filled: readonly string[] = cards.map(c => c.id),
  over: { layout?: Layout; index?: TreeIndex; archived?: Set<CanvasId> } = {},
) =>
  unsentSignals({
    mine: ownCards(ADA, cards),
    filled: new Set(filled.map(textCardId)),
    layout: over.layout ?? layout,
    archived: over.archived ?? new Set(),
    canvases,
    index: over.index ?? tree(),
  })
const sets = (m: ReturnType<typeof marks>) => ({
  canvases: [...m.canvases],
  ends: [...m.ends],
  elsewhere: m.elsewhere,
})

describe("signals as one family", () => {
  test("signalWords is total: every signal has words of its own", () => {
    for (const signal of SIGNALS) expect(signalWords(signal)).not.toBe("")
    expect(new Set(SIGNALS.map(signalWords)).size).toBe(SIGNALS.length)
    expect(elsewhereWords("needs-you")).toBe(
      "a canvas not in the sidebar: needs you",
    )
  })
  test("a status's signal: its level, done while a finished run fades over nothing raised, else none", () => {
    const status = (level: (typeof LEVELS)[number], raised = true): Status => ({
      level,
      raised,
      item: null,
    })
    expect(statusSignal(status("running"), true)).toBe("running")
    expect(statusSignal(status("needs-you"), true)).toBe("needs-you")
    expect(statusSignal(status("worth-a-read"), false)).toBe("worth-a-read")
    expect(statusSignal(status("ready", false), false)).toBe("ready")
    expect(statusSignal(status("ready", false), true)).toBe("done")
    expect(statusSignal(null, true)).toBe("done")
    expect(statusSignal(null, false)).toBeNull()
  })
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
  test("your message marks its canvas and its thread's end", () => {
    expect(sets(marks([atEnd("c", "e2")]))).toEqual({
      canvases: [K("e1")],
      ends: ["e2"],
      elsewhere: false,
    })
  })

  test("a note you own marks its note column's canvas, and no thread's end", () => {
    const note: CardRecord = {
      ...atEnd("c", "e2"),
      place: { kind: "note", column: NOTES, order: "a" },
    }
    // g1's canvas is closed: ▦ is marked.
    expect(sets(marks([note]))).toEqual({
      canvases: [K("g1")],
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
      canvases: [],
      ends: [],
      elsewhere: false,
    })
  })

  test("your message in a root this tab does not hold marks its thread's canvas, with no end", () => {
    const m = marks([atEnd("c", "f2")])
    expect(sets(m).canvases).toEqual([K("f1")])
    expect(sets(m).ends).toEqual([])
    expect(m.elsewhere).toBe(true)
  })

  test("it follows its thread as the thread grows", () => {
    const grown = tree(said("e3", "e2"))
    expect([
      ...marks([atEnd("c", "e2")], ["c"], { index: grown }).ends,
    ]).toEqual(["e3"])
  })

  test("your message at a thread not yet started marks its canvas, with no end", () => {
    expect(sets(marks([atUnstarted("c", BRANCH)]))).toEqual({
      canvases: [K("e1")],
      ends: [],
      elsewhere: false,
    })
  })

  test("your message at a thread on no canvas marks nothing", () => {
    expect(
      sets(marks([atUnstarted("c", threadIdFor("elsewhere"))])).canvases,
    ).toEqual([])
  })

  test("only your cards, only with text, only where their place still is", () => {
    const none = { canvases: [], ends: [], elsewhere: false }
    expect(sets(marks([atEnd("c", "e2", BEA)]))).toEqual(none)
    expect(sets(marks([atEnd("c", "e2")], []))).toEqual(none)
    expect(sets(marks([atEnd("c", "gone")]))).toEqual(none)
  })

  test("elsewhere: a marked canvas you closed", () => {
    expect(marks([atEnd("c", "g1")]).elsewhere).toBe(true)
    expect(marks([atUnstarted("c", G_BRANCH)]).elsewhere).toBe(true)
    const closed = { ...layout, open: [] }
    expect(marks([atEnd("c", "e2")], ["c"], { layout: closed }).elsewhere).toBe(
      true,
    )
  })

  test("an archived canvas marks its row, never ▦", () => {
    const m = marks([atEnd("c", "g1")], ["c"], {
      archived: new Set([K("g1")]),
    })
    expect([...m.canvases]).toEqual([K("g1")])
    expect(m.elsewhere).toBe(false)
  })
})

describe("a status's words", () => {
  const item = {
    lane: _TEST_THREAD,
    end: entryId("e"),
    level: "needs-you",
    raised: {
      kind: "run-end",
      report: { kind: "model-said", urgency: "needs-you", reason: "asks why" },
      ask: entryId("p"),
    },
  } as const
  const nameOf = (w: string) => w

  test("a status's title is its level's words, then its item's reason", () => {
    expect(
      statusWords({ level: "needs-you", raised: true, item }, nameOf),
    ).toBe("needs you: asks why")
    expect(
      statusWords({ level: "running", raised: true, item: null }, nameOf),
    ).toBe("the agent is working")
  })

  test("a column's status says a word only while it is raised, and none for running or accepted", () => {
    const of = (level: (typeof LEVELS)[number], raised = true) =>
      statusWord({ level, raised, item: null })
    expect(of("needs-you")).toBe("needs you")
    expect(of("conflicts")).toBe("conflicts")
    expect(of("ready")).toBe("ready")
    expect(of("worth-a-read")).toBe("worth a read")
    expect(of("running")).toBeNull()
    expect(of("accepted")).toBeNull()
    expect(of("needs-you", false)).toBeNull()
    expect(statusWord(null)).toBeNull()
  })
})
