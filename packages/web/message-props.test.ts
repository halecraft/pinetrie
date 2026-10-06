import { entryId, streamId } from "@pinetrie/core"
import {
  messageTools,
  projectColumns,
  type RowMemory,
  screenMemory,
} from "@pinetrie/interface"
import { entry, indexOf } from "@pinetrie/interface/fixtures"
import { newLiveDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { type MessageProps, sameMessageProps } from "./message-props.ts"

const ROWS = screenMemory<RowMemory>()

/** A message's props as `Column` builds them, from entries built afresh. */
const props = (
  text: string,
  over: Partial<MessageProps> = {},
): MessageProps => {
  const index = indexOf([
    entry("a", null, { role: "user", content: "first" }),
    entry("b", "a", { role: "user", content: text }),
  ])
  const [view] = projectColumns(index, [{ anchor: entryId("b") }])
  const node = view?.nodes[1]
  if (node === undefined) throw new Error("no node")
  return {
    node,
    streams: {},
    live: LIVE,
    rows: ROWS,
    nameOf: NAMES,
    tools: messageTools(node, {
      parentId: entryId("a"),
      isLast: true,
      lane: { kind: "none" },
      writable: true,
    }),
    onAct: ACT,
    join: undefined,
    pinned: undefined,
    forkTracks: [],
    closedBranches: [],
    ...over,
  }
}
const NAMES = new Map()
const LIVE = newLiveDoc()
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
        closedBranches: [{ rootId: entryId("c"), messageCount: 1 }],
      }),
    ),
  ).toBe(false)
  expect(
    sameMessageProps(
      was,
      props("hello", {
        tools: {
          ...was.tools,
          branch: {
            kind: "branch",
            branch: { at: entryId("b"), prefill: undefined },
          },
        },
      }),
    ),
  ).toBe(false)
  expect(sameMessageProps(was, props("hello", { onAct: () => {} }))).toBe(false)
  // One of its own calls starts streaming.
  expect(
    sameMessageProps(was, props("hello", { streams: { c1: streamId("s1") } })),
  ).toBe(false)
})

test("its calls' streams, rebuilt unchanged, draw the same", () => {
  expect(
    sameMessageProps(
      props("hello", { streams: { c1: streamId("s1") } }),
      props("hello", { streams: { c1: streamId("s1") } }),
    ),
  ).toBe(true)
})
