import { entryId, threadIdFor } from "@pinetrie/core"
import { type CardId, cardIdOfKind } from "@pinetrie/threads"
import { expect, test } from "vitest"
import { columnHead } from "./column-menu.ts"
import { foldToggle } from "./folded-column-view.ts"

const NOTES = cardIdOfKind("note-column", "n")
const menuOf = (
  card: CardId = threadIdFor("a"),
  width: 1 | 2 = 1,
  writable = true,
) =>
  columnHead({
    card,
    width,
    writable,
    unstarted: false,
    folded: false,
    ticked: false,
    density: null,
    start: null,
    pin: false,
    renamable: false,
  }).menu

test("a column's ⋯ makes its card wide, or narrow again, for everyone", () => {
  const card = threadIdFor("a")
  expect(menuOf(card, 1)[0]?.items).toMatchObject([
    { label: "Make wide", intent: { kind: "card-width", card, width: 2 } },
  ])
  expect(menuOf(card, 2)[0]?.items[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "card-width", card, width: 1 },
  })
})

test("a thread's ⋯ copies it here or into your inventory, and takes it; it lists no canvases", () => {
  const card = threadIdFor("a")
  const sections = menuOf(card)
  expect(sections.map(s => s.key)).toEqual(["canvas", "thread", "trash"])
  expect(
    sections[1]?.items.map(i => [i.label, i.kind === "intent" && i.intent]),
  ).toEqual([
    ["Copy to this canvas", { kind: "copy-thread", source: card, to: "here" }],
    [
      "Copy to your inventory",
      { kind: "copy-thread", source: card, to: "inventory" },
    ],
    ["Move to your inventory", { kind: "put-away", card }],
  ])
  expect(menuOf(NOTES).map(s => s.key)).toEqual(["canvas", "trash"])
})

test("a column's ⋯ ends in Move to trash for a reader who may write, and offers none to one who may not", () => {
  for (const card of [threadIdFor("a"), NOTES]) {
    expect(menuOf(card).at(-1)).toEqual({
      key: "trash",
      items: [
        {
          kind: "intent",
          key: "trash",
          label: "Move to trash",
          title: expect.any(String),
          intent: { kind: "trash", card, at: { kind: "column", key: card } },
        },
      ],
    })
    expect(menuOf(card, 1, false).map(s => s.key)).not.toContain("trash")
  }
})

test("a column's head starts with its toggle: it folds a started thread or a note column, and trashes a thread not yet started with its bin", () => {
  const thread = threadIdFor("a")
  const head = (card: CardId, unstarted: boolean, writable: boolean) =>
    columnHead({
      card,
      width: 1,
      writable,
      unstarted,
      folded: false,
      ticked: false,
      density: null,
      start: null,
      pin: false,
      renamable: false,
    })
  for (const [card, writable] of [
    [thread, true],
    [thread, false],
    [NOTES, true],
    [NOTES, false],
  ] as const)
    expect(head(card, false, writable).toggle).toEqual({
      words: foldToggle(false),
      intent: { kind: "fold", card, unfolded: false },
    })
  const unstarted = head(thread, true, true)
  expect(unstarted.toggle?.words).toMatchObject({
    label: "trash",
    className: "trash-column",
  })
  expect(unstarted.toggle?.intent).toEqual(
    (() => {
      const item = unstarted.menu.at(-1)?.items[0]
      return item?.kind === "intent" ? item.intent : undefined
    })(),
  )
  expect(head(thread, true, false).toggle).toBeNull()
})

test("folded, a column's head unfolds it from the same toggle, keeps its box, and has no ⋯", () => {
  const card = threadIdFor("a")
  const folded = columnHead({
    card,
    width: 1,
    writable: true,
    unstarted: false,
    folded: true,
    ticked: true,
    density: null,
    start: null,
    pin: false,
    renamable: false,
  })
  expect(folded.toggle).toEqual({
    words: foldToggle(true),
    intent: { kind: "fold", card, unfolded: true },
  })
  expect(folded.box.ticked).toBe(true)
  expect(folded.menu).toEqual([])
})

test("a column's box asks the other state, for everyone; a reader who may not change the canvas sees it and cannot change it", () => {
  const card = threadIdFor("a")
  const box = (ticked: boolean, writable: boolean) =>
    columnHead({
      card,
      width: 1,
      writable,
      unstarted: false,
      folded: false,
      ticked,
      density: null,
      start: null,
      pin: false,
      renamable: false,
    }).box
  expect(box(false, true).intent).toEqual({
    kind: "card-tick",
    card,
    ticked: true,
  })
  expect(box(true, true).intent).toEqual({
    kind: "card-tick",
    card,
    ticked: false,
  })
  expect(box(true, false)).toMatchObject({ ticked: true, intent: null })
})

const head = (over: Partial<Parameters<typeof columnHead>[0]> = {}) =>
  columnHead({
    card: NOTES,
    width: 1,
    writable: true,
    unstarted: false,
    folded: false,
    ticked: false,
    density: null,
    start: null,
    pin: false,
    renamable: false,
    ...over,
  })

test("a list column's ⋯ starts with Rename for a reader who may write; a thread's offers Pin a card when it may pin", () => {
  const first = (h: ReturnType<typeof head>) =>
    h.menu[0]?.items.map(i => i.kind)
  expect(first(head({ renamable: true }))).toEqual(["rename", "intent"])
  expect(first(head())).toEqual(["intent"])
  expect(first(head({ card: threadIdFor("a"), pin: true }))).toEqual([
    "pin",
    "intent",
  ])
})

test("a thread's ⋯ starts with three reading choices, the current one checked, then Go to where it started when there is a start", () => {
  const card = threadIdFor("a")
  const start = entryId("e-3")
  const menu = head({ card, density: "story", start }).menu
  expect(menu[0]).toEqual({
    key: "reading",
    items: [
      expect.objectContaining({
        kind: "density",
        density: "outline",
        checked: false,
      }),
      expect.objectContaining({
        kind: "density",
        density: "story",
        checked: true,
      }),
      expect.objectContaining({
        kind: "density",
        density: "raw",
        checked: false,
      }),
    ],
  })
  expect(menu.find(m => m.key === "thread")?.items[0]).toMatchObject({
    kind: "intent",
    key: "where-it-started",
    intent: {
      kind: "column",
      column: { kind: "card", card },
      act: { kind: "open-at", entry: start },
    },
  })
  const plain = head({ card }).menu
  expect(plain.map(m => m.key)).not.toContain("reading")
  expect(
    plain.find(m => m.key === "thread")?.items.map(i => i.key),
  ).not.toContain("where-it-started")
  expect(head({ density: null }).menu.map(m => m.key)).not.toContain("reading")
})
