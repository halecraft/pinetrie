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
  answersFor,
  emptyAccess,
  planAccessAnswer,
  planAccessAsk,
  planAccessChange,
  planAccessOutside,
  planAccessRecovery,
  planAccessUse,
  planPersonalSign,
} from "./access.ts"

const LANE = threadIdFor("t-1")
const DUANE = writerId("duane@x.io")
const BEA = writerId("bea@x.io")

const STATES: Record<PersonalAccess["kind"], PersonalAccess> = {
  waiting: { kind: "waiting", host: "pop", since: 1 },
  approved: { kind: "approved", host: "pop", by: DUANE, at: 1 },
  refused: { kind: "refused", host: "pop", by: DUANE, at: 1, revoked: false },
}
const at = (personal: PersonalAccess | null): AccessRecord => ({
  ...emptyAccess(LANE),
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
      record: at({
        kind: "refused",
        host: "pop",
        by: DUANE,
        at: 2,
        revoked: true,
      }),
    })
  })

  test("an answer keeps the host its request named", () => {
    const approved = answer(at(STATES.waiting), "approve")
    expect("record" in approved && approved.record.personal?.host).toBe("pop")
  })
})

describe("asking", () => {
  test("a lane that never asked waits", () => {
    expect(
      planAccessAsk({ record: at(null), host: "pop", now: 3 }).personal,
    ).toEqual({ kind: "waiting", host: "pop", since: 3 })
  })

  test("a refused lane stays refused", () => {
    expect(
      planAccessAsk({ record: at(STATES.refused), host: "pop", now: 3 }),
    ).toEqual(at(STATES.refused))
  })

  test("a starting host keeps a lane's request", () => {
    expect(
      planAccessRecovery([at(STATES.waiting), at(STATES.approved)]),
    ).toEqual([])
  })

  test("a starting host clears a refusal for a host outside", () => {
    const refused = {
      ...at(STATES.approved),
      outside: { host: "hql", key: "SHA256:k", at: 1 },
    }
    expect(planAccessRecovery([refused])).toEqual([at(STATES.approved)])
  })
})

describe("planPersonalSign", () => {
  const sign = (record: AccessRecord, mayAsk = true) =>
    planPersonalSign({ record, mayAsk, host: "hql", now: 4 })

  test("an approved lane signs; any other is refused at once", () => {
    expect(sign(at(STATES.approved))).toEqual({ signs: true, write: null })
    for (const state of [STATES.waiting, STATES.refused])
      expect(sign(at(state))).toEqual({ signs: false, write: null })
  })

  test("a lane that never asked asks as it is refused", () => {
    expect(sign(at(null))).toEqual({
      signs: false,
      write: at({ kind: "waiting", host: "hql", since: 4 }),
    })
  })

  test("a lane that may not ask writes nothing", () => {
    for (const personal of [null, STATES.approved])
      expect(sign(at(personal), false)).toEqual({ signs: false, write: null })
  })
})

describe("planAccessOutside", () => {
  test("the same refusal for a host outside writes nothing again", () => {
    const refusal = { host: "hql", key: "SHA256:k" }
    const once = planAccessOutside(emptyAccess(LANE), refusal, 3)
    expect(once?.outside).toEqual({ ...refusal, at: 3 })
    expect(once && planAccessOutside(once, refusal, 4)).toBeNull()
    expect(
      once && planAccessOutside(once, { ...refusal, key: "SHA256:j" }, 5),
    ).not.toBeNull()
  })
})

test("a use is recorded once, in first-use order", () => {
  const once = planAccessUse(emptyAccess(LANE), { kind: "host", name: "pop" })
  expect(once?.hosts).toEqual(["pop"])
  expect(once && planAccessUse(once, { kind: "host", name: "pop" })).toBeNull()
  expect(
    planAccessUse(emptyAccess(LANE), { kind: "service", name: "deploy" })
      ?.services,
  ).toEqual(["deploy"])
})

describe("planAccessChange", () => {
  const OWNER = writerId("owner@x.io")
  const change = (prev: PersonalAccess | null, next: PersonalAccess | null) =>
    planAccessChange(prev, next, OWNER)

  test("a request is news once, and each answer is news", () => {
    expect(change(null, STATES.waiting)).toEqual({
      kind: "asked",
      host: "pop",
      owner: OWNER,
    })
    expect(change(STATES.waiting, STATES.waiting)).toBeNull()
    expect(change(STATES.waiting, STATES.approved)).toEqual({
      kind: "approved",
      host: "pop",
      owner: DUANE,
    })
    expect(change(STATES.waiting, STATES.refused)?.kind).toBe("refused")
    expect(change(STATES.refused, STATES.approved)?.kind).toBe("approved")
  })

  test("taking back an approval is revoked news", () => {
    expect(
      change(STATES.approved, {
        kind: "refused",
        host: "pop",
        by: DUANE,
        at: 1,
        revoked: true,
      }),
    ).toEqual({ kind: "revoked", host: "pop", owner: DUANE })
  })
})
