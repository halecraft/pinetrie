import { type CardId, cardIdOfKind } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { CARD_HISTORY, decodeCard } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { planCardContent } from "./0009-card-content.ts"

const ROW = {
  owner: "w-ada@x.io",
  placer: "w-ada@x.io",
  root: "",
  column: "",
  order: "",
  by: "",
  seen: "",
  command: "",
  fact: "",
  unsent: "",
  holder: "",
  task: "",
  width: "",
  at: "",
  lane: "",
  kind: "",
}
const LANE = "t-0123456789abcdef"
const FACT = JSON.stringify({ kind: "described", lane: LANE, by: "w-ada@x.io" })
const MESSAGE = cardIdFor("c1")
const OLD_FACT = cardIdFor("c2")
const NEW_FACT = cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1")

const stored = {
  [MESSAGE]: { ...ROW, kind: "drafting", at: "e-1", lane: LANE },
  [OLD_FACT]: {
    ...ROW,
    kind: "queued",
    at: "e-1",
    lane: LANE,
    order: "a",
    by: "w-ada@x.io",
    fact: FACT,
  },
}
const histories = {
  [OLD_FACT]: {
    events: [
      {
        kind: "created",
        by: null,
        from: null,
        to: { ...ROW, kind: "queued", at: "e-1", lane: LANE },
        at: 1,
      },
    ],
  },
}

describe("0009-card-content (ADR-0126)", () => {
  const plan = planCardContent({
    rows: stored,
    histories,
    newFact: () => NEW_FACT,
  })

  test("a row at a thread loses its `at`, and still decodes as it did", () => {
    expect(plan.rows[MESSAGE]).toEqual({ ...stored[MESSAGE], at: "" })
    expect(decodeCard(MESSAGE, plan.rows[MESSAGE])).toEqual(
      decodeCard(MESSAGE, stored[MESSAGE]),
    )
  })

  test("a fact on a text card's id moves to an `x-` id, a fact card, with its history", () => {
    expect(plan.removed).toEqual([OLD_FACT])
    expect(decodeCard(NEW_FACT, plan.rows[NEW_FACT])).toMatchObject({
      kind: "fact",
      id: NEW_FACT,
      place: { kind: "queued", thread: LANE, order: "a" },
      content: { fact: { kind: "described" } },
    })
    expect(plan.histories).toEqual([
      expect.objectContaining({
        kind: "set",
        namespace: CARD_HISTORY.namespace,
        key: NEW_FACT,
        value: {
          events: [
            expect.objectContaining({
              to: expect.objectContaining({ kind: "queued", at: "" }),
            }),
          ],
        },
      }),
      expect.objectContaining({ kind: "delete", key: OLD_FACT }),
    ])
  })

  test("a second run finds nothing", () => {
    const after: Record<string, typeof ROW> = {
      ...Object.fromEntries(
        Object.entries(stored).filter(([id]) => !plan.removed.includes(id)),
      ),
      ...(plan.rows as Record<string, typeof ROW>),
    }
    const historiesAfter = {
      [NEW_FACT]: plan.histories[0]?.kind === "set" && plan.histories[0].value,
    }
    expect(
      planCardContent({
        rows: after,
        histories: historiesAfter,
        newFact: (): CardId => {
          throw new Error("no fact is left to move")
        },
      }),
    ).toEqual({ rows: {}, removed: [], histories: [] })
  })
})
