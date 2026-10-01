import { type EntryLike, indexTree, projectColumns } from "@pineta/core"
import { newSessionDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { type MessageProps, sameMessageProps } from "./message-props.ts"
import { messageTools } from "./message-tools.ts"
import { screenMemory } from "./screen-memory.ts"
import type { RowMemory } from "./tool-row.ts"

const ROWS = screenMemory<RowMemory>()

const entry = (
  id: string,
  parentId: string | null,
  content: string,
): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role: "user", content },
})

/** A message's props as `Column` builds them, from entries built afresh. */
const props = (
  text: string,
  over: Partial<MessageProps> = {},
): MessageProps => {
  const index = indexTree({
    a: entry("a", null, "first"),
    b: entry("b", "a", text),
  })
  const [view] = projectColumns(index, [{ anchor: "b" }])
  const node = view?.nodes[1]
  if (node === undefined) throw new Error("no node")
  return {
    node,
    streams: {},
    doc: DOC,
    rows: ROWS,
    nameOf: NAMES,
    about: undefined,
    tools: messageTools(node, {
      parentId: "a",
      isLast: true,
      lane: { kind: "none" },
      writable: true,
      hasNoteAbout: false,
    }),
    onAct: ACT,
    join: undefined,
    forkTracks: [],
    closedBranches: [],
    ...over,
  }
}
const NAMES = new Map()
const DOC = newSessionDoc()
const ACT = () => {}

test("props rebuilt from an unchanged message draw the same", () => {
  expect(sameMessageProps(props("hello"), props("hello"))).toBe(true)
})

test("a change to what a message shows, or a new handler, draws again", () => {
  const was = props("hello")
  expect(sameMessageProps(was, props("hello!"))).toBe(false)
  expect(
    sameMessageProps(
      was,
      props("hello", {
        closedBranches: [{ rootId: "c", messageCount: 1, noteCount: 0 }],
      }),
    ),
  ).toBe(false)
  expect(
    sameMessageProps(
      was,
      props("hello", {
        tools: {
          ...was.tools,
          branch: { kind: "branch", branch: { at: "b", prefill: undefined } },
        },
      }),
    ),
  ).toBe(false)
  expect(sameMessageProps(was, props("hello", { onAct: () => {} }))).toBe(false)
  // One of its own calls starts streaming.
  expect(sameMessageProps(was, props("hello", { streams: { c1: "s1" } }))).toBe(
    false,
  )
})

test("its calls' streams, rebuilt unchanged, draw the same", () => {
  expect(
    sameMessageProps(
      props("hello", { streams: { c1: "s1" } }),
      props("hello", { streams: { c1: "s1" } }),
    ),
  ).toBe(true)
})
