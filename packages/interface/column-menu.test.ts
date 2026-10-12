import { cardIdOfKind, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { columnMenu } from "./column-menu.ts"

test("a column's ⋯ makes its card wide, or narrow again, for everyone", () => {
  const card = threadIdFor("a")
  expect(columnMenu({ card, width: 1 })[1]?.items).toMatchObject([
    { label: "Make wide", intent: { kind: "cardWidth", card, width: 2 } },
  ])
  expect(columnMenu({ card, width: 2 })[1]?.items[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "cardWidth", card, width: 1 },
  })
})

test("a column's ⋯ holds its fold first, yours alone, for a thread and a note column alike", () => {
  for (const card of [threadIdFor("a"), cardIdOfKind("note-column", "n")]) {
    const [yours] = columnMenu({ card, width: 1 })
    expect(yours?.key).toBe("yours")
    expect(yours?.items).toMatchObject([
      {
        key: "fold",
        label: "Fold",
        intent: { kind: "fold", card, unfolded: false },
      },
    ])
  }
})

test("a thread's ⋯ copies it here or into your inventory, and takes it; it lists no tasks", () => {
  const card = threadIdFor("a")
  const sections = columnMenu({ card, width: 1 })
  expect(sections.map(s => s.key)).toEqual(["yours", "canvas", "thread"])
  expect(sections[2]?.items.map(i => [i.label, i.intent])).toEqual([
    ["Copy to this task", { kind: "copyThread", source: card, to: "here" }],
    [
      "Copy to your inventory",
      { kind: "copyThread", source: card, to: "inventory" },
    ],
    ["Move to your inventory", { kind: "takeIntoInventory", card }],
  ])
  const notes = columnMenu({ card: cardIdOfKind("note-column", "n"), width: 1 })
  expect(notes.map(s => s.key)).toEqual(["yours", "canvas"])
})
