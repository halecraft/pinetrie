import { canvasIdFor, entryId, threadIdFor, writerId } from "@pinetrie/core"
import type {
  Reach,
  RelayDetails,
  ThreadLane,
  TranscriptMessage,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { planDelivery } from "./message.ts"
import { planAnswer, planRelay, relayRefusalText } from "./relay.ts"

const here = threadIdFor("here")
const fox = threadIdFor("fox")
const ada = writerId("ada@example.com")
const idle: ThreadLane = {
  kind: "lane",
  name: fox,
  tip: entryId("t"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
}
const OPEN: Reach = { kind: "open", canvas: canvasIdFor("t") }
const BEA = writerId("bea@example.com")
const ARCHIVED: Reach = {
  kind: "archived",
  canvas: canvasIdFor("t"),
  record: { canvas: canvasIdFor("t"), by: BEA, at: 1 },
}
const at = (id: string, text: string) => ({
  id: entryId(id),
  thread: here,
  text,
})
const agent = (id: string, text: string): TranscriptMessage => ({
  ...at(id, text),
  role: "assistant",
})
const path: readonly TranscriptMessage[] = [
  {
    ...at("1", "please talk to @amber-fox"),
    role: "person",
    author: "Ada",
    compelled: true,
    writer: writerId("ada@x.io"),
    sendId: "s-1",
  },
  agent("2", "I will ask it"),
  { ...at("3", "fox said so"), role: "answer", author: "amber-fox", from: fox },
  agent("4", "and now"),
  agent("5", "asking again"),
]
const relay = (over: Partial<Parameters<typeof planRelay>[0]> = {}) =>
  planRelay({
    from: here,
    fromName: "sable-meadow",
    to: fox,
    toName: "amber-fox",
    toForeign: null,
    fromReach: OPEN,
    toReach: OPEN,
    members: [fox],
    toLane: idle,
    path,
    lastIncoming: null,
    lastInvitation: entryId("1"),
    source: entryId("5"),
    asker: { kind: "agent", thread: here },
    askerName: "sable-meadow",
    text: "what next?",
    allowance: entryId("1"),
    spent: false,
    by: ada,
    ...over,
  })

describe("planRelay", () => {
  test("it hears what was said from its invite on, not the ask nor its own answers", () => {
    const plan = relay()
    expect(plan.kind).toBe("relay")
    if (plan.kind !== "relay") return
    expect(plan.incoming?.details.entries).toEqual([
      entryId("1"),
      entryId("2"),
      entryId("4"),
    ])
    expect(plan.incoming?.lines).toEqual([
      "Ada: please talk to @amber-fox",
      "agent: I will ask it",
      "agent: and now",
    ])
    expect(plan.relay).toMatchObject({ source: "5", allowance: "1", by: ada })
  })
  test("after what it heard last; nothing new, nothing heard", () => {
    const plan = relay({ lastIncoming: entryId("4") })
    expect(plan.kind === "relay" && plan.incoming).toBeNull()
  })
  test("a thread out of reach is refused first, the asked one's or the asker's", () => {
    expect(relay({ toReach: ARCHIVED, members: [] })).toEqual({
      kind: "refused",
      why: { kind: "away", side: "to", name: "amber-fox", reach: ARCHIVED },
    })
    const asker = relay({ fromReach: { kind: "held", by: BEA } })
    expect(asker).toMatchObject({ why: { kind: "away", side: "from" } })
    if (asker.kind !== "refused") return
    expect(relayRefusalText(asker.why, () => "Bea")).toBe(
      "Bea has sable-meadow: its ask was not relayed.",
    )
  })
  test("only a member with a lane, while the budget lasts, is asked", () => {
    expect(relay({ members: [] })).toEqual({
      kind: "refused",
      why: { kind: "not-member", name: "amber-fox" },
    })
    expect(relay({ toLane: { kind: "none" } })).toMatchObject({
      why: { kind: "no-lane" },
    })
    expect(relay({ spent: true })).toMatchObject({ why: { kind: "spent" } })
    expect(relay({ to: here })).toMatchObject({ why: { kind: "self" } })
  })
  test("a thread whose lane keeps a history of another kind cannot be asked, and is told why", () => {
    const lane = { kind: "foreign", lane: fox, history: "folder" } as const
    const refused = relay({ toForeign: lane })
    expect(refused).toEqual({
      kind: "refused",
      why: { kind: "foreign", name: "amber-fox", lane },
    })
    if (refused.kind !== "refused") return
    expect(relayRefusalText(refused.why, () => "Bea")).toBe(
      "amber-fox cannot be asked: this thread's work was made when the project had no jj repo.",
    )
  })
})

describe("planAnswer", () => {
  const asked: RelayDetails = {
    from: here,
    fromName: "sable-meadow",
    source: entryId("5"),
    asker: { kind: "agent", thread: here },
    askerName: "sable-meadow",
    text: "what next?",
    allowance: entryId("1"),
    by: ada,
  }
  const answer = (over: Partial<Parameters<typeof planAnswer>[0]> = {}) =>
    planAnswer({
      relay: asked,
      relayEntry: entryId("r"),
      thread: fox,
      name: "amber-fox",
      end: { kind: "answered", text: "this" },
      spent: false,
      fromReach: OPEN,
      ...over,
    })
  test("an answer to an agent's ask wakes it", () => {
    expect(answer()).toEqual({
      kind: "answer",
      answer: {
        from: fox,
        fromName: "amber-fox",
        relay: entryId("r"),
        source: entryId("5"),
        text: "this",
        wakes: true,
        allowance: entryId("1"),
        by: ada,
      },
    })
  })
  test("an answer to a person's ask, or past the budget, wakes nobody", () => {
    const person = answer({
      relay: { ...asked, asker: { kind: "person", writer: ada } },
    })
    expect(person.kind === "answer" && person.answer.wakes).toBe(false)
    const spent = answer({ spent: true })
    expect(spent.kind === "answer" && spent.answer.wakes).toBe(false)
  })
  test("an answer to a thread gone out of reach is not sent", () => {
    expect(answer({ fromReach: ARCHIVED })).toEqual({
      kind: "undelivered",
      reach: ARCHIVED,
    })
  })
  test("a stopped or failed run sends no answer", () => {
    expect(answer({ end: { kind: "stopped" } })).toEqual({
      kind: "unanswered",
      why: "stopped",
    })
    expect(answer({ end: { kind: "failed" } })).toEqual({
      kind: "unanswered",
      why: "failed",
    })
  })
})

describe("planDelivery: one table for sends, relays and answers", () => {
  const go = (lane: ThreadLane, compelled: boolean, steers = false) =>
    planDelivery({ lane, compelled, mode: "queue", race: null, steers })
  test("an idle lane runs or appends; no lane appends to the tree or is made", () => {
    expect(go(idle, true)).toEqual({ kind: "run", thread: fox })
    expect(go(idle, false)).toEqual({ kind: "append-to-lane", thread: fox })
    expect(go({ kind: "none" }, false)).toEqual({ kind: "append-to-tree" })
    expect(go({ kind: "none" }, true)).toEqual({ kind: "create-and-run" })
  })
  test("a running lane is busy, unless the message steers into it", () => {
    const running = { ...idle, running: true }
    expect(go(running, true)).toEqual({ kind: "busy" })
    expect(go(running, false, true)).toEqual({ kind: "steer", thread: fox })
    expect(go(running, true, true)).toEqual({ kind: "steer", thread: fox })
  })
})
