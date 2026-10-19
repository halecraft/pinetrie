import { entryId, threadIdFor, writerId } from "@pinetrie/core"
import {
  newLiveDoc,
  newRootDoc,
  newSessionDoc,
  storedChat,
  writeDigest,
  writeLaneTip,
  writeMessage,
} from "@pinetrie/interface/fixtures"
import { expect, test } from "vitest"
import { type Reader, threadLines } from "./draw.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@example.com")
const reader: Reader = {
  me: ADA,
  nameOf: new Map([[ADA, "Ada"]]),
  draft: "go on",
}

/** A thread where Ada asked, the agent worked and answered, and its ask has a digest. */
function askedAndAnswered() {
  const root = newRootDoc()
  writeMessage(root, {
    id: "e1",
    parent: null,
    thread: LANE,
    message: storedChat("Fix the bug", ADA, "Ada"),
  })
  writeMessage(root, {
    id: "e2",
    parent: "e1",
    thread: LANE,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Looking." }],
      stopReason: "toolUse",
    },
  })
  writeMessage(root, {
    id: "e3",
    parent: "e2",
    thread: LANE,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Fixed." }],
      stopReason: "stop",
    },
  })
  writeLaneTip(root, LANE, entryId("e3"))
  return root
}

test("a thread's prompt, its ask's work folded and its last word, and the composer's button", () => {
  const view = {
    session: newSessionDoc(),
    live: newLiveDoc(),
    roots: [askedAndAnswered()],
  }
  expect(threadLines(view, LANE, reader)).toEqual([
    "Ada: Fix the bug",
    "  ▸ 2 steps",
    "  agent: Fixed.",
    "[send to agent]",
  ])
})

test("an ask's digest is drawn with its points, after the fold interface anchors it to", () => {
  const root = askedAndAnswered()
  writeDigest(root, entryId("e1"), {
    headline: "Fixed the bug",
    points: ["found the cause", "added a test"],
  })
  const lines = threadLines(
    { session: newSessionDoc(), live: newLiveDoc(), roots: [root] },
    LANE,
    reader,
  )
  expect(lines).toEqual([
    "Ada: Fix the bug",
    "  ▸ 2 steps",
    "  ◆ Fixed the bug",
    "    - found the cause",
    "    - added a test",
    "  agent: Fixed.",
    "[send to agent]",
  ])
})
