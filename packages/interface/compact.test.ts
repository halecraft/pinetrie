import {
  type CardPlace,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  type NoteColumnCard,
  type RelayDetails,
  type Sha256,
  type TextCard,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, threadOfEntry } from "@pinetrie/core/fixtures"
import type { NoteCard } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Column } from "./columns.ts"
import {
  type CompactFacts,
  cardCompact,
  compactWords,
  DETAIL_ON,
  type Detail,
  type DrawnCard,
  type DrawnKind,
} from "./compact.ts"
import { tree } from "./fixtures.ts"
import { foldedMark, foldedView, foldedWords } from "./folded-column-view.ts"
import {
  focusTitle,
  type ThreadGlance,
  threadFocus,
  threadGlance,
} from "./thread-glance.ts"
import { builtInIconUrl, threadIcon } from "./thread-icon.ts"

const ADA = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const T = threadIdFor("t")
const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000aa")
const C = cardIdFor("c1")

const text: TextCard = {
  kind: "text",
  id: C,
  owner: BEA,
  placer: BEA,
  place: { kind: "inventory", holder: ADA },
  content: { command: "bring-up-to-date", unsent: null, origin: null },
}
const note: NoteCard = {
  ...text,
  place: {
    kind: "note",
    column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000aa"),
    order: "a",
  },
}
const notes: NoteColumnCard = {
  kind: "note-column",
  id: N,
  owner: ADA,
  placer: ADA,
  place: { kind: "canvas", canvas: CANVAS, order: "a", width: 1 },
  content: NO_CONTENT,
}
const threadGlanceOfT: ThreadGlance = threadGlance({
  thread: T,
  index: tree({ "1-r": null }),
  lanes: [],
  names: new Map([[T, "amber-fox" as never]]),
  focuses: new Map(),
  iconFor: () => null,
})
const facts: CompactFacts = {
  tone: "inventory",
  key: "1",
  texts: new Map([[C, "\n\none\n\ntwo\nthree"]]),
  threads: new Map([[T, threadGlanceOfT]]),
  notes: new Map([
    [N, { column: N, title: "Ideas", titled: "Ideas", notes: [note, note] }],
  ]),
  threadNames: new Map([[T, "amber-fox" as never]]),
}
const QUOTE = "a".repeat(64) as Sha256
const reference: DrawnCard = {
  kind: "reference",
  id: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e3"),
  owner: ADA,
  placer: ADA,
  place: { kind: "inventory", holder: ADA },
  content: {
    address: { kind: "entry", thread: T, entry: entryId("1-r") },
    quote: QUOTE,
  },
}
const threadCard: DrawnCard = {
  kind: "thread",
  id: T,
  owner: ADA,
  placer: ADA,
  place: { kind: "inventory", holder: ADA },
  content: NO_CONTENT,
}
const relay: RelayDetails = {
  from: threadIdFor("here"),
  fromName: "sable-meadow",
  source: entryId("5"),
  asker: { kind: "agent", thread: threadIdFor("here") },
  askerName: "sable-meadow",
  text: "what next?",
  budget: entryId("1"),
  by: ADA,
}
/** One card of every drawn kind: a kind left out does not compile. */
const EVERY_KIND: Readonly<Record<DrawnKind, DrawnCard>> = {
  text,
  reference,
  thread: threadCard,
  "note-column": notes,
  fact: {
    kind: "fact",
    id: cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1"),
    owner: ADA,
    placer: ADA,
    place: { kind: "queued", thread: T, order: "a", by: ADA, seen: "" },
    content: { fact: { kind: "described", lane: T, by: ADA } },
  },
  ask: {
    kind: "ask",
    id: cardIdOfKind("ask", "01a0ffd2-0000-7000-8000-0000000000a1"),
    owner: ADA,
    placer: ADA,
    place: { kind: "queued", thread: T, order: "a", by: ADA, seen: "" },
    content: { relay },
  },
}

describe("cardCompact", () => {
  test("every drawn kind's compact has a lead", () => {
    for (const card of Object.values(EVERY_KIND)) {
      const { lead } = cardCompact(card, facts)
      expect(
        lead.kind === "quote" || lead.text.trim() !== "",
        `${card.kind}: ${JSON.stringify(lead)}`,
      ).toBe(true)
    }
  })

  test("a text card: its first line, then its second, blank lines left out", () => {
    const compact = cardCompact(text, facts)
    expect(compact).toEqual({
      kind: "text",
      card: C,
      tone: "inventory",
      mark: { kind: "writer", writer: BEA },
      command: "bring-up-to-date",
      lead: { kind: "text", text: "one" },
      second: "two",
      badge: { kind: "key", key: "1" },
    })
    expect(
      compactWords(compact, { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }),
    ).toEqual({ owner: "Bea", command: "catch up", badge: "1" })
  })

  test("a reference: its quote, its kind's words until read, then the thread it is from", () => {
    expect(cardCompact(reference, facts)).toMatchObject({
      mark: { kind: "writer", writer: ADA },
      lead: { kind: "quote", quote: QUOTE, until: "a message" },
      second: "from amber-fox",
    })
  })

  test("a thread: its name, then where it ended, its status as the badge", () => {
    const glance = { ...threadGlanceOfT, last: "done", stopped: true }
    const compact = cardCompact(threadCard, {
      ...facts,
      threads: new Map([[T, glance]]),
    })
    expect(compact).toMatchObject({
      mark: { kind: "thread", icon: null },
      lead: { kind: "text", text: "amber-fox" },
      second: "done",
      badge: { kind: "status", glance },
    })
    expect(compactWords(compact, { me: ADA, nameOf: new Map() }).badge).toBe(
      "stopped",
    )
    const focused = {
      ...glance,
      focus: { kind: "model", text: "Fixing" } as const,
    }
    expect(
      cardCompact(threadCard, { ...facts, threads: new Map([[T, focused]]) })
        .second,
    ).toBe("Fixing")
    expect(
      cardCompact(threadCard, { ...facts, threads: new Map() }),
    ).toMatchObject({ lead: { kind: "text", text: "a thread" }, second: null })
  })

  test("a note column: its title and how many notes it holds; unread, none", () => {
    expect(cardCompact(notes, facts)).toMatchObject({
      lead: { kind: "text", text: "Ideas" },
      second: "2 notes",
    })
    expect(cardCompact(notes, { ...facts, notes: new Map() })).toMatchObject({
      second: null,
    })
  })
})

describe("a folded column", () => {
  test("draws a note column's glance and a thread's, worded for its strip", () => {
    const folded = foldedView(
      { kind: "notes", card: N, folded: true, width: 1 },
      { threadGlanceOf: () => threadGlanceOfT, notes: facts.notes },
    )
    expect(folded).toEqual({
      kind: "note-column",
      card: N,
      title: "Ideas",
      notes: 2,
    })
    const thread = foldedView(
      { kind: "thread", card: T, column: {} as Column, folded: true, width: 1 },
      { threadGlanceOf: () => threadGlanceOfT, notes: facts.notes },
    )
    expect(thread).toBe(threadGlanceOfT)
    expect(thread === null ? null : foldedWords(thread)).toEqual({
      title: "amber-fox",
      detail: null,
      hint: null,
    })
    expect(folded === null ? null : foldedWords(folded)).toEqual({
      title: "Ideas",
      detail: "2 notes",
      hint: null,
    })
  })
})

test("a thread's glance carries its icon, a chat's with no lane included", () => {
  const names = new Map([[T, "amber-fox" as never]])
  const glance = threadGlance({
    thread: T,
    index: tree({ "1-r": null }),
    lanes: [],
    names,
    focuses: new Map(),
    iconFor: thread =>
      threadIcon({
        thread,
        names,
        banners: new Map(),
        icons: { source: "built-in" },
      }),
  })
  expect(glance.icon).toEqual({
    kind: "built-in",
    url: builtInIconUrl("fox"),
  })
})

describe("foldedMark", () => {
  test("a thread's strip draws its icon, or ✦ without one; a note column's draws none", () => {
    expect(
      foldedMark({
        ...threadGlanceOfT,
        icon: { kind: "banner", url: "/blob/a" },
      }),
    ).toEqual({
      kind: "thread",
      icon: { kind: "banner", url: "/blob/a", fade: false },
    })
    expect(foldedMark(threadGlanceOfT)).toEqual({ kind: "thread", icon: null })
    const folded = foldedView(
      { kind: "notes", card: N, folded: true, width: 1 },
      { threadGlanceOf: () => threadGlanceOfT, notes: facts.notes },
    )
    expect(folded === null ? null : foldedMark(folded)).toEqual({
      kind: "none",
    })
  })
})

describe("DETAIL_ON", () => {
  test("a canvas draws full, a dock or a list normal, an inventory compact", () => {
    expect(DETAIL_ON.canvas).toBe("full")
    expect(DETAIL_ON.queued).toBe("normal")
    expect(DETAIL_ON.note).toBe("normal")
    expect(DETAIL_ON.inventory).toBe("compact")
  })

  test("the table is total over places", () => {
    // @ts-expect-error: a place left out does not compile
    const missing: Record<CardPlace["kind"], Detail> = {
      composing: "normal",
    }
    expect(Object.keys(DETAIL_ON).length).toBeGreaterThan(
      Object.keys(missing).length,
    )
  })
})

describe("threadFocus", () => {
  const index = tree({ "1-r": null })
  const F = threadOfEntry("1-r")
  test("a thread with a focus says it, a model's", () => {
    expect(
      threadFocus({
        focuses: new Map([
          [
            F,
            { thread: F, focus: "Fixing the rail", ask: entryId("1-r"), at: 1 },
          ],
        ]),
        index,
        thread: F,
      }),
    ).toEqual({ kind: "model", text: "Fixing the rail" })
  })
  test("a thread with none shows its first message's first line, not as a model's", () => {
    expect(threadFocus({ focuses: new Map(), index, thread: F })).toEqual({
      kind: "opening",
      text: "1-r",
    })
    expect(
      threadFocus({ focuses: new Map(), index: tree({}), thread: F }),
    ).toBeNull()
    expect(focusTitle({ kind: "model", text: "Fixing" })).toBe(
      "Fixing\nwritten by a model",
    )
  })
})
