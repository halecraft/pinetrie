import type { AgentMessage, CompactResult } from "@earendil-works/pi-agent-core"
import { canvasIdFor, threadIdFor, writerId } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { encodeCanvas, encodeCanvasPinned, encodePinned } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { carryContext, withCarried } from "./pinned.ts"

const read = (text: string) => [
  { id: cardIdFor("c1"), text, by: writerId("ada@x.io") },
]
const cards = (text: string) =>
  encodePinned(
    { lane: threadIdFor("x"), cards: read(text), retired: [] },
    () => "Ada",
    1,
  ) as unknown as AgentMessage
const canvasCards = (text: string) =>
  encodeCanvasPinned(
    { canvas: canvasIdFor("t"), cards: read(text), retired: [] },
    () => "Ada",
    1,
  ) as unknown as AgentMessage
const canvasEntry = (line: string) =>
  encodeCanvas(
    { canvas: canvasIdFor("t"), title: "T", lines: [line], more: 0 },
    1,
  ) as unknown as AgentMessage
const user = (text: string) =>
  ({ role: "user", content: text, timestamp: 1 }) as AgentMessage
const prep = (
  messagesToSummarize: AgentMessage[],
  turnPrefixMessages: AgentMessage[],
  retainedTail: AgentMessage[],
) => ({ messagesToSummarize, turnPrefixMessages, retainedTail })

describe("carryContext: what a compaction carries into its retained tail", () => {
  test("nothing summarised is a context entry: nothing", () => {
    expect(carryContext(prep([user("a")], [user("b")], [user("c")]))).toEqual(
      [],
    )
  })

  test("the newest cards entry summarised, the turn's prefix after the rest, when the tail has none", () => {
    const old = cards("old")
    const newer = cards("newer")
    const newest = cards("newest")
    expect(
      carryContext(prep([old, user("a"), newer], [], [user("c")])),
    ).toEqual([newer])
    expect(
      carryContext(prep([old, user("a")], [newest, user("b")], [user("c")])),
    ).toEqual([newest])
  })

  test("the tail holds its own: nothing", () => {
    expect(
      carryContext(prep([cards("old")], [], [cards("kept"), user("c")])),
    ).toEqual([])
  })

  test("every kind is carried, the newest of each, in the context table's order; a kind the tail holds is not", () => {
    const [c, t, p] = [canvasEntry("one"), canvasCards("pin"), cards("mine")]
    expect(
      carryContext(
        prep([p, user("a"), t, canvasEntry("old"), c], [], [user("c")]),
      ),
    ).toEqual([c, t, p])
    expect(
      carryContext(prep([p, t, c], [], [canvasCards("kept"), user("c")])),
    ).toEqual([c, p])
  })
})

test("withCarried puts the entries at the head of the tail, and changes nothing else", () => {
  const result: CompactResult = {
    summary: "s",
    tokensBefore: 9,
    retainedTail: [user("c")],
    details: { readFiles: [], modifiedFiles: [] },
  }
  const carried = [canvasEntry("kept"), cards("kept")]
  expect(withCarried(result, carried)).toEqual({
    ...result,
    retainedTail: [...carried, user("c")],
  })
})
