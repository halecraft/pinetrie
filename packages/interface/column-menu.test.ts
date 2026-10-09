import { taskIdFor, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { columnMenu } from "./column-menu.ts"

test("a column's ⋯ makes its card wide, or narrow again, and a note column just after it, for everyone (ADR-0116)", () => {
  const card = threadIdFor("a")
  expect(columnMenu({ card, width: 1 })).toMatchObject([
    { label: "Make wide", intent: { kind: "cardWidth", card, width: 2 } },
    { intent: { kind: "addNoteColumn", after: card } },
  ])
  expect(columnMenu({ card, width: 2 })[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "cardWidth", card, width: 1 },
  })
})

test("a thread's ⋯ moves it to each other task or your inventory, and copies it to this task, each other, or your inventory (ADR-0117)", () => {
  const card = threadIdFor("a")
  const here = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
  const there = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
  const items = columnMenu({
    card,
    width: 1,
    thread: {
      here,
      tasks: [
        { task: here, label: "Here" },
        { task: there, label: "There" },
      ],
    },
  })
  expect(
    items.filter(i => i.section !== "canvas").map(i => [i.label, i.intent]),
  ).toEqual([
    ["Move to There", { kind: "moveThread", thread: card, task: there }],
    ["Move to your inventory", { kind: "takeIntoInventory", card }],
    ["Copy to this task", { kind: "copyThread", source: card, task: here }],
    ["Copy to There", { kind: "copyThread", source: card, task: there }],
    [
      "Copy to your inventory",
      { kind: "copyThread", source: card, task: null },
    ],
  ])
})
