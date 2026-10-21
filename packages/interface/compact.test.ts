import {
  canvasIdFor,
  entryId,
  type Sha256,
  THE_AGENT,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { factLine, type NoteCard, relayLine } from "@pinetrie/rules"
import {
  type CardPlace,
  cardIdOfKind,
  type NoteColumnCard,
  type RelayDetails,
  type TextCard,
  UNTICKED,
} from "@pinetrie/threads"
import { cardIdFor, threadOfEntry } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { hostCardLine } from "./card-words.ts"
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
  aboutKind,
  aboutTooltip,
  type ThreadGlance,
  threadAbout,
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
  content: { command: "get-latest", unsent: null, origin: null },
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
  content: UNTICKED,
}
const threadGlanceOfT: ThreadGlance = threadGlance({
  thread: T,
  index: tree({ "1-r": null }),
  lanes: [],
  names: new Map([[T, "amber-fox" as never]]),
  titles: new Map(),
  focuses: new Map(),
  statuses: new Map(),
  iconFor: () => null,
})
const M = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000e5")
const IMAGE = cardIdOfKind("image", "01a0ffd2-0000-7000-8000-0000000000e6")
const facts: CompactFacts = {
  tone: "inventory",
  key: "1",
  texts: new Map([[C, "\n\none\n\ntwo\nthree"]]),
  threads: new Map([[T, threadGlanceOfT]]),
  notes: new Map([
    [N, { column: N, title: "Ideas", titled: "Ideas", notes: [note, note] }],
  ]),
  media: new Map([
    [M, { column: M, title: "Mockups", titled: "Mockups", images: [] }],
  ]),
  titles: new Map([[IMAGE, { card: IMAGE, title: "home", by: ADA, at: 1 }]]),
  threadNames: new Map([[T, "amber-fox" as never]]),
}
const QUOTE = "a".repeat(64) as Sha256
const version = (at: number) => ({
  sha256: QUOTE,
  original: QUOTE,
  mimeType: "image/png" as const,
  width: 4,
  height: 3,
  by: ADA,
  at,
})
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
  content: UNTICKED,
}
const relay: RelayDetails = {
  from: threadIdFor("here"),
  fromName: "sable-meadow",
  source: entryId("5"),
  asker: { kind: "agent", thread: threadIdFor("here") },
  askerName: "sable-meadow",
  text: "what next?",
  allowance: entryId("1"),
  by: ADA,
}
/** One card of every drawn kind: a kind left out does not compile. */
const EVERY_KIND: Readonly<Record<DrawnKind, DrawnCard>> = {
  text,
  reference,
  thread: threadCard,
  "note-column": notes,
  media: {
    kind: "media",
    id: M,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    content: UNTICKED,
  },
  image: {
    kind: "image",
    id: IMAGE,
    owner: ADA,
    placer: ADA,
    place: { kind: "image", column: M, order: "a" },
    content: { versions: [version(1), version(2)] },
  },
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
  test("a fact's lead is its fact's line and an ask's its relay's, the line the page draws at every width", () => {
    const { fact, ask } = EVERY_KIND
    if (fact.kind !== "fact" || ask.kind !== "ask")
      throw new Error("EVERY_KIND holds each kind under its own key")
    expect(cardCompact(fact, facts).lead).toEqual({
      kind: "text",
      text: hostCardLine(fact),
    })
    expect(hostCardLine(fact)).toBe(factLine(fact.content.fact))
    expect(cardCompact(ask, facts).lead).toEqual({
      kind: "text",
      text: hostCardLine(ask),
    })
    expect(hostCardLine(ask)).toBe(relayLine(ask.content.relay))
  })

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
      command: "get-latest",
      lead: { kind: "text", text: "one" },
      second: "two",
      badge: { kind: "key", key: "1" },
    })
    expect(
      compactWords(compact, { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }),
    ).toEqual({ owner: "Bea", command: "get the latest", badge: "1" })
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
    const second = (about: ThreadGlance["about"]) =>
      cardCompact(threadCard, {
        ...facts,
        threads: new Map([[T, { ...glance, about }]]),
      }).second
    expect(
      second({ kind: "focus", focus: { kind: "model", text: "Fixing" } }),
    ).toBe("Fixing")
    expect(
      second({ kind: "title", title: { title: "Sync, again", by: ADA } }),
    ).toBe("Sync, again")
    expect(
      second({ kind: "focus", focus: { kind: "opening", text: "Hi there" } }),
    ).toBe("done")
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
      { kind: "notes", card: N, folded: true, width: 1, ticked: false },
      {
        threadGlanceOf: () => threadGlanceOfT,
        notes: facts.notes,
        media: facts.media,
      },
    )
    expect(folded).toEqual({
      kind: "note-column",
      card: N,
      title: "Ideas",
      count: 2,
    })
    const thread = foldedView(
      {
        kind: "thread",
        card: T,
        column: {} as Column,
        folded: true,
        width: 1,
        ticked: false,
      },
      {
        threadGlanceOf: () => threadGlanceOfT,
        notes: facts.notes,
        media: facts.media,
      },
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
    titles: new Map(),
    focuses: new Map(),
    statuses: new Map(),
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

test("a media column's compact is its title and how many images it holds; an image's, its title and its version", () => {
  const media = cardCompact(EVERY_KIND.media, facts)
  expect([media.lead, media.second]).toEqual([
    { kind: "text", text: "Mockups" },
    "no images",
  ])
  const image = cardCompact(EVERY_KIND.image, facts)
  expect([image.lead, image.second]).toEqual([
    { kind: "text", text: "home" },
    "2 of 2",
  ])
  const folded = foldedView(
    { kind: "media", card: M, folded: true, width: 1, ticked: false },
    {
      threadGlanceOf: () => threadGlanceOfT,
      notes: facts.notes,
      media: facts.media,
    },
  )
  expect(folded === null ? null : foldedWords(folded)).toEqual({
    title: "Mockups",
    detail: "no images",
    hint: null,
  })
})

test("a folded thread's strip hints at its title", () => {
  expect(
    foldedWords({
      ...threadGlanceOfT,
      about: { kind: "title", title: { title: "The rail", by: ADA } },
    }).hint,
  ).toBe("The rail")
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
      { kind: "notes", card: N, folded: true, width: 1, ticked: false },
      {
        threadGlanceOf: () => threadGlanceOfT,
        notes: facts.notes,
        media: facts.media,
      },
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
  })
})

describe("threadAbout", () => {
  const index = tree({ "1-r": null })
  const F = threadOfEntry("1-r")
  const focuses = new Map([
    [F, { thread: F, focus: "Fixing the rail", ask: entryId("1-r"), at: 1 }],
  ])
  const titles = new Map([
    [F, { card: F, title: "The rail, for good", by: ADA, at: 1 }],
  ])
  test("a thread's title, while it has one, before its focus", () => {
    expect(threadAbout({ titles, focuses, index, thread: F })).toEqual({
      kind: "title",
      title: { title: "The rail, for good", by: ADA },
    })
    expect(
      threadAbout({ titles: new Map(), focuses, index, thread: F }),
    ).toEqual({
      kind: "focus",
      focus: { kind: "model", text: "Fixing the rail" },
    })
  })
  test("its kind is a title's, a model's focus's or the opening's", () => {
    expect(
      [
        { kind: "title", title: { title: "The rail", by: ADA } } as const,
        { kind: "focus", focus: { kind: "model", text: "Fixing" } } as const,
        { kind: "focus", focus: { kind: "opening", text: "Hi" } } as const,
      ].map(aboutKind),
    ).toEqual(["title", "model", "opening"])
  })
  test("its tooltip says who set a title, and that a model wrote a focus", () => {
    const nameOf = new Map([[ADA, "Ada"]])
    expect(
      aboutTooltip(
        { kind: "title", title: { title: "The rail", by: ADA } },
        nameOf,
      ),
    ).toBe("The rail\nset by Ada")
    expect(
      aboutTooltip(
        { kind: "title", title: { title: "The rail", by: THE_AGENT } },
        nameOf,
      ),
    ).toBe("The rail\nset by the agent")
    expect(
      aboutTooltip(
        { kind: "focus", focus: { kind: "model", text: "Fixing" } },
        nameOf,
      ),
    ).toBe("Fixing\nwritten by a model")
    expect(
      aboutTooltip(
        { kind: "focus", focus: { kind: "opening", text: "Hi" } },
        nameOf,
      ),
    ).toBe("Hi")
  })
})
