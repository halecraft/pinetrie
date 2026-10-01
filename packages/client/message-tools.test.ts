import {
  address,
  laneNameForThread,
  parseMentions,
  type ThreadLane,
  type TranscriptMessage,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { branchPrefill, messageTools } from "./message-tools.ts"

const agentWork: ThreadLane = {
  kind: "lane",
  name: laneNameForThread("t"),
  tip: "9-t",
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
}
const conversation: ThreadLane = { kind: "none" }

const chat = (text: string, compelled: boolean): TranscriptMessage => ({
  id: "5-m",
  role: "chat",
  text,
  compelled,
})

const tools = (
  node: TranscriptMessage,
  over: Partial<Parameters<typeof messageTools>[1]> = {},
) =>
  messageTools(node, {
    parentId: "4-p",
    isLast: false,
    lane: agentWork,
    writable: true,
    hasNoteAbout: false,
    ...over,
  })

describe("edit", () => {
  // Messages as their threads' defaults and mentions made them (ADR-0021).
  const cases: readonly TranscriptMessage[] = [
    chat("just us", false),
    chat("fix the test", true),
    chat("@agent fix the test", true),
    chat("@ada have a look", false),
    chat("/pkg:review the diff", true),
    chat("ask @agent, then @ada", true),
  ]

  test("an edit asks the agent exactly when the original did", () => {
    for (const node of cases) {
      const edit = tools(node).edit
      const text = edit?.prefill?.text ?? ""
      const asks = address({
        mentions: parseMentions(text),
        participants: ["Ada"],
        agentByDefault: false,
      }).compels.kind
      expect(asks === "agent", node.text).toBe(node.compelled === true)
    }
  })

  test("is a branch at the parent, its text as sent, content that sends unchanged", () => {
    expect(tools(chat("just us", false)).edit).toEqual({
      kind: "branch",
      at: "4-p",
      prefill: { text: "just us", blank: false },
    })
    expect(tools(chat("fix the test", true)).edit?.prefill?.text).toBe(
      "@agent fix the test",
    )
  })

  test("never doubles @agent, and leaves a command as typed", () => {
    expect(tools(chat("@agent fix it", true)).edit?.prefill?.text).toBe(
      "@agent fix it",
    )
    expect(tools(chat("/pkg:review", false)).edit?.prefill?.text).toBe(
      "/pkg:review",
    )
  })

  test("a root's first message opens a new tab, asking the agent when it did", () => {
    expect(tools(chat("start here", true), { parentId: null }).edit).toEqual({
      kind: "newTab",
      asksAgent: true,
      prefill: { text: "start here", blank: false },
    })
    expect(
      tools(chat("start here", false), { parentId: null }).edit,
    ).toMatchObject({ kind: "newTab", asksAgent: false })
  })

  test("only a person's message", () => {
    for (const role of ["assistant", "land", "update", "stack"])
      expect(tools({ id: "5-m", role, text: "x" }).edit, role).toBeUndefined()
  })
})

describe("note", () => {
  test("offered until the message has a note about it", () => {
    expect(tools(chat("x", false)).note).toBe(true)
    expect(tools(chat("x", false), { hasNoteAbout: true }).note).toBe(false)
  })
})

describe("→", () => {
  test("a branch at the message, with @agent typed in agent work", () => {
    expect(tools(chat("x", false)).branch).toEqual({
      at: "5-m",
      prefill: { text: "@agent ", blank: true },
    })
    expect(tools(chat("x", false), { lane: conversation }).branch).toEqual({
      at: "5-m",
      prefill: undefined,
    })
  })

  test("hidden at a conversation's last message, shown at agent work's", () => {
    expect(
      tools(chat("x", false), { isLast: true, lane: conversation }).branch,
    ).toBeUndefined()
    expect(tools(chat("x", false), { isLast: true }).branch).toBeDefined()
  })
})

describe("copy", () => {
  test("offered for a message with text or tool calls, and none with neither", () => {
    const call = { id: "c", name: "bash", label: "bash ls" }
    expect(tools(chat("x", false)).copy).toBe(true)
    expect(
      tools({ id: "5-m", role: "assistant", text: "", toolCalls: [call] }).copy,
    ).toBe(true)
    expect(
      tools({ id: "5-m", role: "assistant", text: "", toolCalls: [] }).copy,
    ).toBe(false)
  })
})

test("a column that can't be written offers only copy", () => {
  expect(tools(chat("x", true), { writable: false })).toEqual({
    copy: true,
    note: false,
    edit: undefined,
    branch: undefined,
  })
})

test("branchPrefill: @agent, blank, in agent work; nothing in a conversation", () => {
  expect(branchPrefill(agentWork)).toEqual({ text: "@agent ", blank: true })
  expect(branchPrefill(conversation)).toBeUndefined()
})
