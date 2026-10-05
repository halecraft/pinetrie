import {
  laneNameForThread,
  type OfferFact,
  type OfferRecord,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  actionFact,
  decodeFact,
  decodeOfferFact,
  encodeFact,
  encodeOfferFact,
  factContent,
  factLine,
  integratedFact,
  renderableMessage,
} from "./index.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada@x.io")
const INTEGRATED: OfferFact = {
  kind: "integrated",
  lane: LANE,
  by: ADA,
  as: "kabcdefghij",
  bookmark: "pinetrie-onto",
  to: { kind: "line" },
}
const FACTS: readonly OfferFact[] = [
  INTEGRATED,
  {
    ...INTEGRATED,
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
      decodeOfferFact(JSON.stringify({ ...INTEGRATED, lane: "main" })),
    ).toBeUndefined()
    expect(
      decodeFact({ role: "custom", customType: "pinetrie.fact" }),
    ).toBeUndefined()
  })

  test.each([
    [INTEGRATED, "✓ accepted as kabcdefg"],
    [FACTS[1], "✓ accepted into wip/search as kabcdefg"],
    [FACTS[2], "✎ a new description was asked for"],
    [FACTS[3], "⇣ the stack was squashed into one revision"],
    [FACTS[4], "↻ the offer was rebuilt from this thread's work"],
  ] as const)("factLine: %o", (fact, line) => {
    expect(fact === undefined ? undefined : factLine(fact)).toBe(line)
  })

  test("the model reads who did it, and an integration's change and bookmark", () => {
    expect(factContent(INTEGRATED, "Ada")).toContain(
      "Ada accepted this thread's work, as the change kabcdefghij: pinetrie-onto moved forward to it.",
    )
    expect(factContent(FACTS[4] as OfferFact, "Ada")).toMatch(/^Ada rebuilt/)
  })

  test("the column draws it as its one line, role fact", () => {
    expect(renderableMessage(encodeFact(INTEGRATED, "Ada", 1))).toEqual({
      role: "fact",
      content: "✓ accepted as kabcdefg",
    })
  })

  test("integratedFact: the bookmark moved, the line or a WIP as the thread knows it", () => {
    const decision = {
      kind: "integrate",
      name: "amber-fox" as ThreadName,
      bookmark: "pinetrie-offer/amber-fox",
      destination: "pinetrie-onto",
      top: "kabcdefghij",
      integrated: {} as OfferRecord,
    } as const
    expect(
      integratedFact({ lane: LANE, by: ADA, decision, onto: "pinetrie-onto" }),
    ).toEqual(INTEGRATED)
    expect(
      integratedFact({
        lane: LANE,
        by: ADA,
        decision: { ...decision, destination: "wip/search" },
        onto: "pinetrie-onto",
      }),
    ).toMatchObject({ to: { kind: "wip", bookmark: "wip/search" } })
    expect(actionFact("squash", LANE, ADA)).toEqual(FACTS[3])
  })
})
