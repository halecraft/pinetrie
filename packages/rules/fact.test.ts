import {
  canvasIdFor,
  entryId,
  type JjProposedChangesRecord,
  type ProposedChangesFact,
  type QueuedFact,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { acceptedFact, actionFact } from "./fact.ts"
import {
  decodeFact,
  decodeQueuedFact,
  encodeFact,
  encodeQueuedFact,
  factContent,
  factLine,
  renderableMessage,
} from "./index.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const ACCEPTED: ProposedChangesFact = {
  kind: "accepted",
  lane: LANE,
  by: ADA,
  as: "kabcdefghij",
  bookmark: "pinetrie-accepted",
  to: { kind: "accepted" },
}
const FACTS: readonly ProposedChangesFact[] = [
  ACCEPTED,
  {
    ...ACCEPTED,
    bookmark: "wip/search",
    to: { kind: "unfinished", bookmark: "wip/search" },
  },
  { kind: "described", lane: LANE, by: ADA },
  { kind: "squashed", lane: LANE, by: ADA },
  { kind: "refreshed", lane: LANE, by: ADA },
]

describe("a fact", () => {
  test("round-trips as a message and as a card's field; junk is none", () => {
    for (const fact of FACTS) {
      expect(decodeFact(encodeFact(fact, "Ada", 1))).toEqual(fact)
      expect(decodeQueuedFact(encodeQueuedFact(fact))).toEqual(fact)
    }
    expect(decodeQueuedFact("{")).toBeUndefined()
    expect(
      decodeQueuedFact(JSON.stringify({ ...ACCEPTED, lane: "main" })),
    ).toBeUndefined()
    expect(
      decodeFact({ role: "custom", customType: "pinetrie.fact" }),
    ).toBeUndefined()
  })

  test("a proposal's branches opened round-trip, worded with who pressed and each title", () => {
    const fact: QueuedFact = {
      kind: "branched",
      lane: LANE,
      by: ADA,
      proposal: entryId("r"),
      how: "started",
      titles: ["one", "two"],
    }
    expect(decodeFact(encodeFact(fact, "Ada", 1))).toEqual(fact)
    expect(decodeQueuedFact(encodeQueuedFact(fact))).toEqual(fact)
    expect(factLine(fact)).toBe("⑂ 2 branches started from the proposal")
    expect(factContent(fact, "Ada")).toContain("Ada started 2 branches")
    expect(factContent(fact, "Ada")).toContain("one; two")
  })

  test("an answer not sent says where its asker went, and round-trips", () => {
    const fact: QueuedFact = {
      kind: "undelivered",
      lane: LANE,
      to: threadIdFor("2"),
      toName: "sable-meadow",
      why: {
        kind: "archived",
        canvas: canvasIdFor("t"),
        record: { canvas: canvasIdFor("t"), by: ADA, at: 1 },
      },
      by: ADA,
    }
    expect(decodeFact(encodeFact(fact, "Ada", 1))).toEqual(fact)
    expect(decodeQueuedFact(encodeQueuedFact(fact))).toEqual(fact)
    expect(factLine(fact)).toBe(
      "■ the answer was not sent: sable-meadow's canvas is archived",
    )
  })

  test("an acceptance is stored as the fact it is; one stored under the kind facts began with does not decode", () => {
    expect(encodeFact(ACCEPTED, "Ada", 1).details).toEqual(ACCEPTED)
    expect(JSON.parse(encodeQueuedFact(ACCEPTED))).toEqual(ACCEPTED)
    const older = { ...ACCEPTED, kind: "integrated", to: { kind: "line" } }
    expect(decodeQueuedFact(JSON.stringify(older))).toBeUndefined()
    expect(
      decodeFact({ ...encodeFact(ACCEPTED, "Ada", 1), details: older }),
    ).toBeUndefined()
  })

  test.each([
    [ACCEPTED, "✓ accepted"],
    [FACTS[1], "✓ accepted into wip/search"],
    [FACTS[2], "✎ asked for a new description"],
    [FACTS[3], "⇣ the changes were squashed into one revision"],
    [FACTS[4], "↻ the changes were rebuilt from this thread's work"],
  ] as const)("factLine: %o", (fact, line) => {
    expect(fact === undefined ? undefined : factLine(fact)).toBe(line)
  })

  test("the model reads who did it, and an acceptance's change and bookmark", () => {
    expect(factContent(ACCEPTED, "Ada")).toContain(
      "Ada accepted this thread's work, as the commit with change id kabcdefghij: pinetrie-accepted moved forward to it.",
    )
    expect(factContent(FACTS[4] as ProposedChangesFact, "Ada")).toMatch(
      /^Ada rebuilt/,
    )
  })

  test("the column draws it as its one line, role fact, an acceptance's change id as its detail", () => {
    expect(renderableMessage(encodeFact(ACCEPTED, "Ada", 1))).toEqual({
      role: "fact",
      content: "✓ accepted",
      detail: "change id kabcdefghij",
    })
    expect(
      renderableMessage(encodeFact(FACTS[4] as ProposedChangesFact, "Ada", 1)),
    ).toEqual({
      role: "fact",
      content: "↻ the changes were rebuilt from this thread's work",
    })
  })

  test("acceptedFact: the bookmark moved, accepted work or a WIP as the thread knows it", () => {
    const decision = {
      kind: "accept",
      name: "amber-fox" as ThreadName,
      bookmark: "pinetrie-proposed/amber-fox",
      destination: "pinetrie-accepted",
      top: "kabcdefghij",
      accepted: {} as JjProposedChangesRecord,
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
    ).toMatchObject({ to: { kind: "unfinished", bookmark: "wip/search" } })
    expect(actionFact("squash", LANE, ADA)).toEqual(FACTS[3])
  })
})
