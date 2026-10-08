import {
  type OfferFact,
  type OfferRecord,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  acceptedFact,
  actionFact,
  decodeFact,
  decodeOfferFact,
  encodeFact,
  encodeOfferFact,
  factContent,
  factLine,
  renderableMessage,
} from "./index.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const ACCEPTED: OfferFact = {
  kind: "accepted",
  lane: LANE,
  by: ADA,
  as: "kabcdefghij",
  bookmark: "pinetrie-accepted",
  to: { kind: "accepted" },
}
const FACTS: readonly OfferFact[] = [
  ACCEPTED,
  {
    ...ACCEPTED,
    bookmark: "wip/search",
    to: { kind: "wip", bookmark: "wip/search" },
  },
  { kind: "described", lane: LANE, by: ADA },
  { kind: "squashed", lane: LANE, by: ADA },
  { kind: "refreshed", lane: LANE, by: ADA },
]

describe("a fact (ADR-0080)", () => {
  test("round-trips as a message and as a card's field; junk is none", () => {
    for (const fact of FACTS) {
      expect(decodeFact(encodeFact(fact, "Ada", 1))).toEqual(fact)
      expect(decodeOfferFact(encodeOfferFact(fact))).toEqual(fact)
    }
    expect(decodeOfferFact("{")).toBeUndefined()
    expect(
      decodeOfferFact(JSON.stringify({ ...ACCEPTED, lane: "main" })),
    ).toBeUndefined()
    expect(
      decodeFact({ role: "custom", customType: "pinetrie.fact" }),
    ).toBeUndefined()
  })

  test("an acceptance is stored as the fact it is; one stored under the kind facts began with does not decode", () => {
    expect(encodeFact(ACCEPTED, "Ada", 1).details).toEqual(ACCEPTED)
    expect(JSON.parse(encodeOfferFact(ACCEPTED))).toEqual(ACCEPTED)
    const older = { ...ACCEPTED, kind: "integrated", to: { kind: "line" } }
    expect(decodeOfferFact(JSON.stringify(older))).toBeUndefined()
    expect(
      decodeFact({ ...encodeFact(ACCEPTED, "Ada", 1), details: older }),
    ).toBeUndefined()
  })

  test.each([
    [ACCEPTED, "✓ accepted as kabcdefg"],
    [FACTS[1], "✓ accepted into wip/search as kabcdefg"],
    [FACTS[2], "✎ a new description was asked for"],
    [FACTS[3], "⇣ the stack was squashed into one revision"],
    [FACTS[4], "↻ the offer was rebuilt from this thread's work"],
  ] as const)("factLine: %o", (fact, line) => {
    expect(fact === undefined ? undefined : factLine(fact)).toBe(line)
  })

  test("the model reads who did it, and an acceptance's change and bookmark", () => {
    expect(factContent(ACCEPTED, "Ada")).toContain(
      "Ada accepted this thread's work, as the change kabcdefghij: pinetrie-accepted moved forward to it.",
    )
    expect(factContent(FACTS[4] as OfferFact, "Ada")).toMatch(/^Ada rebuilt/)
  })

  test("the column draws it as its one line, role fact", () => {
    expect(renderableMessage(encodeFact(ACCEPTED, "Ada", 1))).toEqual({
      role: "fact",
      content: "✓ accepted as kabcdefg",
    })
  })

  test("acceptedFact: the bookmark moved, accepted work or a WIP as the thread knows it", () => {
    const decision = {
      kind: "accept",
      name: "amber-fox" as ThreadName,
      bookmark: "pinetrie-offer/amber-fox",
      destination: "pinetrie-accepted",
      top: "kabcdefghij",
      accepted: {} as OfferRecord,
    } as const
    expect(
      acceptedFact({
        lane: LANE,
        by: ADA,
        decision,
        acceptedBookmark: "pinetrie-accepted",
      }),
    ).toEqual(ACCEPTED)
    expect(
      acceptedFact({
        lane: LANE,
        by: ADA,
        decision: { ...decision, destination: "wip/search" },
        acceptedBookmark: "pinetrie-accepted",
      }),
    ).toMatchObject({ to: { kind: "wip", bookmark: "wip/search" } })
    expect(actionFact("squash", LANE, ADA)).toEqual(FACTS[3])
  })
})
