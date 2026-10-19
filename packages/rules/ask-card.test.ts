import { entryId, threadIdFor, writerId } from "@pinetrie/core"
import {
  type CardRecord,
  cardIdOfKind,
  type RelayDetails,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { decodeCard, encodeCard } from "./card.ts"
import { planAskCard, planCarry, planNextQueuedCardPop } from "./queue.ts"

const lane = threadIdFor("fox")
const ada = writerId("ada@example.com")
const relay: RelayDetails = {
  from: threadIdFor("here"),
  fromName: "sable-meadow",
  source: entryId("5"),
  asker: { kind: "agent", thread: threadIdFor("here") },
  askerName: "sable-meadow",
  text: "what next?",
  allowance: entryId("1"),
  by: ada,
}
const ID = cardIdOfKind("ask", "01a0ffd2-0000-7000-8000-0000000000a1")

describe("an ask card", () => {
  const step = planAskCard({ cards: [], id: ID, lane, relay })
  const card = step?.kind === "write" ? step.record : undefined
  test("the host queues it for the person behind the chain, its relay its content", () => {
    expect(card).toMatchObject({
      kind: "ask",
      id: ID,
      owner: ada,
      place: { kind: "queued", thread: lane, by: ada },
      content: { relay },
    })
  })
  test("it is stored in its relay field, and reads back whole", () => {
    if (card === undefined) throw new Error("no card")
    const stored = encodeCard(card)
    expect(JSON.parse(stored.relay)).toEqual(relay)
    expect(decodeCard(ID, stored)).toEqual(card)
  })
  test("popped, it is relayed; a held queue keeps it, as it keeps a message", () => {
    if (card === undefined || card.kind !== "ask") throw new Error("no card")
    expect(planCarry(card, "")).toEqual({ kind: "relay", relay })
    const cards: readonly CardRecord[] = [card]
    const pop = (held: boolean) =>
      planNextQueuedCardPop(cards, lane, {
        running: false,
        away: false,
        held,
        typing: new Set(),
        blank: new Set(),
      })
    expect(pop(false)).toEqual({ kind: "pop", card })
    expect(pop(true)).toEqual({ kind: "held" })
  })
})
