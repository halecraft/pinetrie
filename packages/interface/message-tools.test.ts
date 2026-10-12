import {
  address,
  entryId,
  parseMentions,
  type ThreadLane,
  type TranscriptMessage,
  threadIdFor,
} from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  branchPrefill,
  type MessageTools,
  messageReference,
  messageTools,
  selectionReference,
  showsText,
} from "./message-tools.ts"

const agentWork: ThreadLane = {
  kind: "lane",
  name: threadIdFor("t"),
  tip: entryId("9-t"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
}
const conversation: ThreadLane = { kind: "none" }

const chat = (text: string, compelled: boolean): TranscriptMessage => ({
  id: entryId("5-m"),
  thread: FIXTURE_THREAD,
  role: "chat",
  text,
  compelled,
})

const tools = (
  node: TranscriptMessage,
  over: Partial<Parameters<typeof messageTools>[1]> = {},
) =>
  messageTools(node, {
    parentId: entryId("4-p"),
    isLast: false,
    lane: agentWork,
    writable: true,
    ...over,
  })

/** The text an edit's composer starts with, whichever it opens. */
const editText = (edit: MessageTools["edit"]): string | undefined =>
  edit?.kind === "branch" ? edit.branch.prefill?.text : edit?.prefill.text

describe("edit", () => {
  // Messages as their threads' defaults and mentions made them.
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
      const text = editText(tools(node).edit) ?? ""
      const asks = address({
        mentions: parseMentions(text),
        participants: ["Ada"],
        agents: [],
        agentByDefault: false,
      }).compels.kind
      expect(asks === "agent", node.text).toBe(node.compelled === true)
    }
  })

  test("is a branch at the parent, its text as sent, content that sends unchanged", () => {
    expect(tools(chat("just us", false)).edit).toEqual({
      kind: "branch",
      branch: { at: "4-p", prefill: { text: "just us", blank: false } },
    })
    expect(editText(tools(chat("fix the test", true)).edit)).toBe(
      "@agent fix the test",
    )
  })

  test("never doubles @agent, and leaves a command as typed", () => {
    expect(editText(tools(chat("@agent fix it", true)).edit)).toBe(
      "@agent fix it",
    )
    expect(editText(tools(chat("/pkg:review", false)).edit)).toBe("/pkg:review")
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
      expect(
        tools({ id: entryId("5-m"), thread: FIXTURE_THREAD, role, text: "x" })
          .edit,
        role,
      ).toBeUndefined()
  })
})

describe("→", () => {
  test("a branch at the message, with @agent typed in agent work", () => {
    expect(tools(chat("x", false)).branch).toEqual({
      kind: "branch",
      branch: { at: "5-m", prefill: { text: "@agent ", blank: true } },
    })
    expect(tools(chat("x", false), { lane: conversation }).branch).toEqual({
      kind: "branch",
      branch: { at: "5-m", prefill: undefined },
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
    const call = { id: "c", name: "bash", subject: "ls" }
    expect(tools(chat("x", false)).copy).toBe(true)
    expect(
      tools({
        id: entryId("5-m"),
        thread: FIXTURE_THREAD,
        role: "assistant",
        text: "",
        toolCalls: [call],
      }).copy,
    ).toBe(true)
    expect(
      tools({
        id: entryId("5-m"),
        thread: FIXTURE_THREAD,
        role: "assistant",
        text: "",
        toolCalls: [],
      }).copy,
    ).toBe(false)
  })
})

test("a column that can't be written offers only copy", () => {
  expect(tools(chat("x", true), { writable: false })).toEqual({
    copy: true,
    comment: false,
    edit: undefined,
    branch: undefined,
  })
})

test("branchPrefill: @agent, blank, in agent work; nothing in a conversation", () => {
  expect(branchPrefill(agentWork)).toEqual({ text: "@agent ", blank: true })
  expect(branchPrefill(conversation)).toBeUndefined()
})

test("showsText: a message that only called tools shows only its rows", () => {
  const call = { id: "c", name: "bash", label: "ls" } as never
  expect(
    showsText({
      id: entryId("m"),
      thread: FIXTURE_THREAD,
      role: "assistant",
      text: "",
    }),
  ).toBe(true)
  expect(
    showsText({
      id: entryId("m"),
      thread: FIXTURE_THREAD,
      role: "assistant",
      text: "",
      toolCalls: [call],
    }),
  ).toBe(false)
  expect(
    showsText({
      id: entryId("m"),
      thread: FIXTURE_THREAD,
      role: "assistant",
      text: "so",
      toolCalls: [call],
    }),
  ).toBe(true)
})

describe("taking from the past", () => {
  const node = {
    id: entryId("5-m"),
    thread: FIXTURE_THREAD,
    role: "assistant",
    text: "Plan: **go**\n\n| a |\n|---|\n| 1 |",
    branches: [],
  } as const
  const at = { thread: FIXTURE_THREAD, entry: entryId("5-m") }

  test("a selection whose text is in the message as written is a range of it", () => {
    expect(selectionReference(node, "Plan")).toEqual({
      address: { kind: "range", ...at, from: 0, to: 4 },
      markdown: "Plan",
    })
  })

  test("a selection across formatting, or of only space, takes nothing: never the whole message", () => {
    expect(selectionReference(node, "Plan: go")).toBeNull()
    expect(selectionReference(node, " ")).toBeNull()
  })

  test("a message is the whole message, or the block named, its markdown its source", () => {
    expect(messageReference(node, null)).toEqual({
      address: { kind: "entry", ...at },
      markdown: node.text,
    })
    expect(messageReference(node, { kind: "table", n: 0 })).toEqual({
      address: { kind: "block", ...at, block: { kind: "table", n: 0 } },
      markdown: "| a |\n|---|\n| 1 |",
    })
  })
})
