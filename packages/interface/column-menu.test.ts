import { noteColumnIdFor, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { columnMenu } from "./column-menu.ts"

test("a column's ⋯ makes its card wide, or narrow again, and a note column just after it, for everyone (ADR-0116)", () => {
  const card = threadIdFor("a")
  expect(columnMenu({ card, width: 1 })[0]?.items).toMatchObject([
    { label: "Make wide", intent: { kind: "cardWidth", card, width: 2 } },
    { intent: { kind: "addNoteColumn", after: card } },
  ])
  expect(columnMenu({ card, width: 2 })[0]?.items[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "cardWidth", card, width: 1 },
  })
})

test("a thread's ⋯ copies it here or into your inventory, and takes it; it lists no tasks (ADR-0127)", () => {
  const card = threadIdFor("a")
  const sections = columnMenu({ card, width: 1 })
  expect(sections.map(s => s.key)).toEqual(["canvas", "thread"])
  expect(sections[1]?.items.map(i => [i.label, i.intent])).toEqual([
    ["Copy to this task", { kind: "copyThread", source: card, to: "here" }],
    [
      "Copy to your inventory",
      { kind: "copyThread", source: card, to: "inventory" },
    ],
    ["Move to your inventory", { kind: "takeIntoInventory", card }],
  ])
  const notes = columnMenu({ card: noteColumnIdFor("n"), width: 1 })
  expect(notes.map(s => s.key)).toEqual(["canvas"])
})
