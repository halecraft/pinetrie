import {
  entryId,
  rootIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { attentionWords, type RootRecord } from "@pinetrie/interface"
import { describe, expect, test } from "vitest"
import { mentionLines, needsYouLines, replyTarget } from "./inbox.ts"

const ADA = writerId("ada@example.com")
const BEA = writerId("bea@example.com")
const LANE = threadIdFor("0123456789abcdef")
const END = entryId("01a0ffd2-0000-7000-8000-0000000000e1")
const nameOf = (w: WriterId) => (w === ADA ? "Ada" : w === BEA ? "Bea" : w)

describe("needsYouLines", () => {
  const input: Parameters<typeof needsYouLines>[0] = {
    me: ADA,
    writers: new Map(),
    runEndReports: new Map(),
    openProposed: [],
    sshAsks: [{ lane: LANE, end: END, host: null }],
    owner: ADA,
    person: {
      since: "01a0ffd2-0000-7000-8000-000000000001",
      mentionsSince: "",
      read: new Map(),
      dismissed: new Map(),
      dismissedReady: new Map(),
      seen: new Set<string>(),
    },
    busy: new Set(),
    archived: new Set(),
  }

  test("a lane's ssh ask reaches its owner, in interface's words", () => {
    expect(needsYouLines(input, nameOf)).toEqual([
      `${LANE}: ${attentionWords({ kind: "ssh", host: null }, nameOf)}`,
    ])
  })

  test("it reaches nobody else", () => {
    expect(needsYouLines({ ...input, me: BEA }, nameOf)).toEqual([])
  })
})

test("mentionLines: a send naming you, by who sent it; your own is left out", () => {
  const record: RootRecord = {
    root: rootIdFor("r1"),
    entry: entryId("1-r"),
    first: entryId("1-r"),
    firstLine: "",
    messages: 2,
    newest: entryId("2-a"),
    writers: [],
    threads: {},
    mentions: [
      { id: entryId("1-r"), by: BEA, text: "@ada look", thread: LANE },
      { id: entryId("2-a"), by: ADA, text: "@ada noted", thread: LANE },
    ],
    blobs: [],
  }
  expect(
    mentionLines(
      { roots: [record], me: ADA, myName: "Ada", participants: ["Ada", "Bea"] },
      nameOf,
    ),
  ).toEqual(["Bea: @ada look"])
})

test("replyTarget: a reply goes to the thread's end as you saw it; a queue or a branch, nowhere here", () => {
  expect(replyTarget({ mode: "reply" }, LANE, END)).toEqual({
    kind: "end",
    thread: LANE,
    seen: END,
  })
  expect(replyTarget({ mode: "queue" }, LANE, END)).toBeNull()
  expect(replyTarget({ mode: "branch" }, LANE, END)).toBeNull()
})
