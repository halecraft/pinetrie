import { canvasIdFor, threadIdFor, workflowStateIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  type NewColumnTable,
  newCanvasButton,
  newColumnButton,
} from "./start-button.ts"

const at = {
  kind: "canvas",
  canvas: canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
  after: threadIdFor("a"),
} as const
const TOPICS = { id: workflowStateIdFor("t"), name: "Topics" }

test("＋ past the last column makes an agent thread; its ▾, a chat, a note column and a media column, all at its spot", () => {
  const button = newColumnButton(at)
  expect(button.main.intent).toEqual({
    kind: "addColumn",
    make: { kind: "thread", opens: "agent" },
    at,
  })
  expect(button.more?.items.map(i => i.intent)).toEqual([
    { kind: "addColumn", make: { kind: "thread", opens: "chat" }, at },
    { kind: "addColumn", make: { kind: "note-column" }, at },
    { kind: "addColumn", make: { kind: "media" }, at },
  ])
  expect(button.more?.items.map(i => i.label)).toEqual([
    "chat",
    "note column",
    "media column",
  ])
})

test("＋ canvas makes a canvas, with no ▾", () => {
  const button = newCanvasButton({ from: "sidebar", landsIn: TOPICS })
  expect(button.main.intent).toEqual({ kind: "newCanvas" })
  expect(button.main.label).toBe("canvas")
  expect(button.main.title).toBe(
    "a new canvas at the end of Topics: its first thread starts with @agent typed",
  )
  expect(button.more).toBeNull()
})

test("a board column's ＋ lands its canvas in that column's state", () => {
  const active = { id: workflowStateIdFor("a"), name: "Active" }
  const button = newCanvasButton({ from: "board", landsIn: active })
  expect(button.main.intent).toEqual({ kind: "newCanvas", state: active.id })
  expect(button.main.title).toContain("at the end of Active")
})

test("the table of new columns holds every kind, each column under its own", () => {
  const whole = {
    thread: [{ kind: "thread", opens: "agent" }],
    "note-column": [{ kind: "note-column" }],
    media: [{ kind: "media" }],
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
