import type { AgentMessage, CompactResult } from "@earendil-works/pi-agent-core"
import { cardId, threadIdFor, writerId } from "@pinetrie/core"
import { encodePinned } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { carryPinned, withCarried } from "./pinned.ts"

const cards = (text: string) =>
  encodePinned(
    {
      lane: threadIdFor("x"),
      cards: [{ id: cardId("c-1"), text, by: writerId("ada@x.io") }],
      retired: [],
    },
    () => "Ada",
    1,
  ) as unknown as AgentMessage
const user = (text: string) =>
  ({ role: "user", content: text, timestamp: 1 }) as AgentMessage
const prep = (
  messagesToSummarize: AgentMessage[],
  turnPrefixMessages: AgentMessage[],
  retainedTail: AgentMessage[],
) => ({ messagesToSummarize, turnPrefixMessages, retainedTail })

describe("carryPinned: what a compaction carries into its retained tail", () => {
  test("nothing summarised is a cards entry: nothing", () => {
    expect(carryPinned(prep([user("a")], [user("b")], [user("c")]))).toBeNull()
  })

  test("the newest cards entry summarised, the turn's prefix after the rest, when the tail has none", () => {
    const old = cards("old")
    const newer = cards("newer")
    const newest = cards("newest")
    expect(carryPinned(prep([old, user("a"), newer], [], [user("c")]))).toBe(
      newer,
    )
    expect(
      carryPinned(prep([old, user("a")], [newest, user("b")], [user("c")])),
    ).toBe(newest)
  })

  test("the tail holds its own: nothing", () => {
    expect(
      carryPinned(prep([cards("old")], [], [cards("kept"), user("c")])),
    ).toBeNull()
  })
})

test("withCarried puts the cards at the head of the tail, and changes nothing else", () => {
  const result: CompactResult = {
    summary: "s",
    tokensBefore: 9,
    retainedTail: [user("c")],
    details: { readFiles: [], modifiedFiles: [] },
  }
  const carried = cards("kept")
  expect(withCarried(result, carried)).toEqual({
    ...result,
    retainedTail: [carried, user("c")],
  })
})
