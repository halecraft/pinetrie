import { taskIdFor, threadIdFor, workflowStateIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  type NewColumnTable,
  newColumnButton,
  newTabButton,
  type StartItem,
} from "./start-button.ts"

const at = {
  kind: "canvas",
  task: taskIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
  after: threadIdFor("a"),
} as const

test("＋ past the last column makes an agent thread; its ▾, a conversation and a note column, all at its spot", () => {
  const button = newColumnButton(at)
  expect(button.main.intent).toEqual({
    kind: "addColumn",
    make: { kind: "thread", asksAgent: true },
    at,
  })
  expect(button.more.map(i => i.intent)).toEqual([
    { kind: "addColumn", make: { kind: "thread", asksAgent: false }, at },
    { kind: "addColumn", make: { kind: "note-column" }, at },
  ])
})

test("every ＋ words agent work and a conversation alike", () => {
  const words = ({ key, label, name, title }: StartItem) => ({
    key,
    label,
    name,
    title,
  })
  const column = newColumnButton(at)
  for (const tab of [newTabButton(null), newTabButton(workflowStateIdFor("d"))])
    expect([tab.main, ...tab.more].map(words)).toEqual(
      [column.main, ...column.more.slice(0, 1)].map(words),
    )
})

test("＋ on a board column lands its new tab in that column's state", () => {
  const state = workflowStateIdFor("d")
  expect(newTabButton(state).main.intent).toEqual({
    kind: "newTab",
    asksAgent: true,
    state,
  })
  expect(newTabButton(null).more[0]?.intent).toEqual({
    kind: "newTab",
    asksAgent: false,
  })
})

test("the table of new columns holds every kind, each column under its own", () => {
  const whole = {
    thread: [{ kind: "thread", asksAgent: true }],
    "note-column": [{ kind: "note-column" }],
  } as const satisfies NewColumnTable
  // @ts-expect-error a kind with nothing to make
  const empty = { ...whole, thread: [] } as const satisfies NewColumnTable
  const misplaced = {
    ...whole,
    // @ts-expect-error a column under another kind
    thread: [{ kind: "note-column" }],
  } as const satisfies NewColumnTable
  // @ts-expect-error a kind left out
  const missing = { thread: whole.thread } as const satisfies NewColumnTable
  expect([empty, misplaced, missing]).toHaveLength(3)
})
