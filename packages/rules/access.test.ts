import {
  type AccessAnswer,
  type AccessRecord,
  type PersonalAccess,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  ACCESS_ANSWERS,
  accessOf,
  answersFor,
  planAccessAnswer,
  planAccessAsk,
  planAccessChange,
  planAccessRecovery,
  planAccessTimeout,
  planAccessUse,
} from "./access.ts"
import { decodeOwner } from "./config.ts"

const LANE = threadIdFor("t-1")
const DUANE = writerId("duane@x.io")
const BEA = writerId("bea@x.io")

const STATES: Record<PersonalAccess["kind"], PersonalAccess> = {
  waiting: { kind: "waiting", host: "pop", since: 1 },
  approved: { kind: "approved", by: DUANE, at: 1 },
  refused: { kind: "refused", by: DUANE, at: 1, revoked: false },
  unanswered: { kind: "unanswered", host: "pop", at: 1 },
}
const at = (personal: PersonalAccess | null): AccessRecord => ({
  ...accessOf(LANE),
  personal,
})
const answer = (record: AccessRecord, a: AccessAnswer, sender = DUANE) =>
  planAccessAnswer({ record, answer: a, sender, owner: DUANE, now: 2 })

describe("planAccessAnswer", () => {
  test("only the owner answers", () => {
    expect(answer(at(STATES.waiting), "approve", BEA)).toEqual({
      refused: "not_owner",
    })
    expect(
      planAccessAnswer({
        record: at(STATES.waiting),
        answer: "approve",
        sender: DUANE,
        owner: null,
        now: 2,
      }),
    ).toEqual({ refused: "not_owner" })
  })

  test("each answer the table allows is taken, and every other is refused", () => {
    for (const [kind, state] of Object.entries(STATES))
      for (const a of ["approve", "refuse", "revoke"] as const) {
        const result = answer(at(state), a)
        const allowed =
          ACCESS_ANSWERS[kind as PersonalAccess["kind"]].includes(a)
        expect("record" in result, `${kind} ${a}`).toBe(allowed)
      }
  })

  test("a lane that never asked has nothing to answer", () => {
    expect(answer(at(null), "approve")).toEqual({
      refused: "nothing_to_answer",
    })
    expect(answersFor(at(null))).toEqual([])
  })

  test("a revoke is a refusal that says it was approved first", () => {
    expect(answer(at(STATES.approved), "revoke")).toEqual({
      record: at({ kind: "refused", by: DUANE, at: 2, revoked: true }),
    })
  })
})

describe("asking", () => {
  test("a lane that never asked, or was not answered, waits", () => {
    for (const personal of [null, STATES.unanswered])
      expect(
        planAccessAsk({
          record: at(personal),
          host: "pop",
          now: 3,
        }).personal,
      ).toEqual({ kind: "waiting", host: "pop", since: 3 })
  })

  test("a refused lane stays refused", () => {
    expect(
      planAccessAsk({
        record: at(STATES.refused),
        host: "pop",
        now: 3,
      }),
    ).toEqual(at(STATES.refused))
  })

  test("nobody answering leaves it unanswered", () => {
    expect(planAccessTimeout(at(STATES.waiting), 5).personal).toEqual({
      kind: "unanswered",
      host: "pop",
      at: 5,
    })
  })

  test("a starting host leaves nothing waiting", () => {
    expect(
      planAccessRecovery([at(STATES.waiting), at(STATES.approved)], 9),
    ).toEqual([at({ kind: "unanswered", host: "pop", at: 9 })])
  })
})

test("a use is recorded once, in first-use order", () => {
  const once = planAccessUse(accessOf(LANE), { kind: "host", name: "pop" })
  expect(once?.hosts).toEqual(["pop"])
  expect(once && planAccessUse(once, { kind: "host", name: "pop" })).toBeNull()
  expect(
    planAccessUse(accessOf(LANE), { kind: "service", name: "deploy" })
      ?.services,
  ).toEqual(["deploy"])
})

describe("planAccessChange", () => {
  test("an approval releases what waits", () => {
    expect(planAccessChange(STATES.waiting, STATES.approved)).toBe("release")
  })
  test("a refusal or no answer refuses what waits", () => {
    expect(planAccessChange(STATES.waiting, STATES.refused)).toBe("refuse")
    expect(planAccessChange(STATES.waiting, STATES.unanswered)).toBe("refuse")
  })
  test("only taking back an approval cuts the lane's sessions", () => {
    expect(
      planAccessChange(STATES.approved, {
        kind: "refused",
        by: DUANE,
        at: 2,
        revoked: true,
      }),
    ).toBe("cut")
  })
  test("asking changes nothing that waits", () => {
    expect(planAccessChange(null, STATES.waiting)).toBeNull()
  })
})

test("the owner is an email in the user config, as its writer", () => {
  expect(decodeOwner({ owner: "Duane@X.io" })).toBe(DUANE)
  expect(decodeOwner({ owner: "not an email" })).toBeNull()
  expect(decodeOwner({})).toBeNull()
})
