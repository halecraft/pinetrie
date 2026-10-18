import { type CardId, cardIdOfKind, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { columnHeadEnd } from "./column-menu.ts"
import { FOLD } from "./folded-column-view.ts"

const NOTES = cardIdOfKind("note-column", "n")
const menuOf = (
  card: CardId = threadIdFor("a"),
  width: 1 | 2 = 1,
  writable = true,
) => columnHeadEnd({ card, width, writable, unstarted: false }).menu

test("a column's ⋯ makes its card wide, or narrow again, for everyone", () => {
  const card = threadIdFor("a")
  expect(menuOf(card, 1)[0]?.items).toMatchObject([
    { label: "Make wide", intent: { kind: "cardWidth", card, width: 2 } },
  ])
  expect(menuOf(card, 2)[0]?.items[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "cardWidth", card, width: 1 },
  })
})

test("a thread's ⋯ copies it here or into your inventory, and takes it; it lists no canvases", () => {
  const card = threadIdFor("a")
  const sections = menuOf(card)
  expect(sections.map(s => s.key)).toEqual(["canvas", "thread", "trash"])
  expect(sections[1]?.items.map(i => [i.label, i.intent])).toEqual([
    ["Copy to this canvas", { kind: "copyThread", source: card, to: "here" }],
    [
      "Copy to your inventory",
      { kind: "copyThread", source: card, to: "inventory" },
    ],
    ["Move to your inventory", { kind: "putAway", card }],
  ])
  expect(menuOf(NOTES).map(s => s.key)).toEqual(["canvas", "trash"])
})

test("a column's ⋯ ends in Move to trash for a reader who may write, and offers none to one who may not", () => {
  for (const card of [threadIdFor("a"), NOTES]) {
    expect(menuOf(card).at(-1)).toEqual({
      key: "trash",
      items: [
        {
          key: "trash",
          label: "Move to trash",
          title: expect.any(String),
          intent: { kind: "discard", card, at: { kind: "column", key: card } },
        },
      ],
    })
    expect(menuOf(card, 1, false).map(s => s.key)).not.toContain("trash")
  }
})

test("a column's head folds a started thread or a note column, and trashes a thread not yet started with its bin", () => {
  const thread = threadIdFor("a")
  const head = (card: CardId, unstarted: boolean, writable: boolean) =>
    columnHeadEnd({ card, width: 1, writable, unstarted })
  for (const [card, writable] of [
    [thread, true],
    [thread, false],
    [NOTES, true],
    [NOTES, false],
  ] as const)
    expect(head(card, false, writable).button).toEqual({
      words: FOLD,
      intent: { kind: "fold", card, unfolded: false },
    })
  const unstarted = head(thread, true, true)
  expect(unstarted.button?.words).toMatchObject({
    label: "trash",
    className: "trash-column",
  })
  expect(unstarted.button?.intent).toEqual(
    unstarted.menu.at(-1)?.items[0]?.intent,
  )
  expect(head(thread, true, false).button).toBeNull()
})
