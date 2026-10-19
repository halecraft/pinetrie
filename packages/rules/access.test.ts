import { ERR, threadIdFor, writerId } from "@pinetrie/core"
import type { AccessAnswer } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  ACCESS,
  ACCESS_ANSWERS,
  type AccessRecord,
  answersFor,
  emptyAccess,
  type PersonalAccess,
  planAccessAnswer,
  planAccessAsk,
  planAccessChange,
  planAccessOutside,
  planAccessRecovery,
  planAccessUse,
  planPersonalSign,
} from "./access.ts"
import { setRecord } from "./records.ts"

const LANE = threadIdFor("t-1")
const DUANE = writerId("duane@x.io")
const BEA = writerId("bea@x.io")

const STATES: Record<PersonalAccess["kind"], PersonalAccess> = {
  waiting: { kind: "waiting", host: "pop", since: 1 },
  allowed: { kind: "allowed", host: "pop", by: DUANE, at: 1 },
  denied: { kind: "denied", host: "pop", by: DUANE, at: 1, takenBack: false },
}
const at = (personal: PersonalAccess | null): AccessRecord => ({
  ...emptyAccess(LANE),
  personal,
})
const answer = (record: AccessRecord, a: AccessAnswer, sender = DUANE) =>
  planAccessAnswer({
    lane: LANE,
    record,
    answer: a,
    sender,
    owner: DUANE,
    now: 2,
  })

describe("planAccessAnswer", () => {
  test("only the owner answers", () => {
    expect(answer(at(STATES.waiting), "allow", BEA)).toEqual({
      refused: ERR.NOT_OWNER,
    })
    expect(
      planAccessAnswer({
        lane: LANE,
        record: at(STATES.waiting),
        answer: "allow",
        sender: DUANE,
        owner: null,
        now: 2,
      }),
    ).toEqual({ refused: ERR.NOT_OWNER })
  })

  test("each answer the table allows is taken, and every other is refused", () => {
    for (const [kind, state] of Object.entries(STATES))
      for (const a of ["allow", "deny", "take-back"] as const) {
        const result = answer(at(state), a)
        const allowed =
          ACCESS_ANSWERS[kind as PersonalAccess["kind"]].includes(a)
        expect("record" in result, `${kind} ${a}`).toBe(allowed)
      }
  })

  test("an answer taken is written as the lane's record", () => {
    const result = answer(at(STATES.waiting), "allow")
    if (!("record" in result)) throw new Error("taken")
    expect(result.writes).toEqual([setRecord(ACCESS, result.record)])
  })

  test("a lane that never asked has nothing to answer", () => {
    expect(answer(at(null), "allow")).toEqual({
      refused: ERR.NOTHING_TO_ANSWER,
    })
    expect(answersFor(at(null))).toEqual([])
  })

  test("taking back is a denial that says it was allowed first", () => {
    expect(answer(at(STATES.allowed), "take-back")).toMatchObject({
      record: at({
        kind: "denied",
        host: "pop",
        by: DUANE,
        at: 2,
        takenBack: true,
      }),
    })
  })

  test("an answer keeps the host its request named", () => {
    const approved = answer(at(STATES.waiting), "allow")
    expect("record" in approved && approved.record.personal?.host).toBe("pop")
  })
})

describe("asking", () => {
  test("a lane that never asked waits", () => {
    expect(
      planAccessAsk({ record: at(null), host: "pop", now: 3 }).personal,
    ).toEqual({ kind: "waiting", host: "pop", since: 3 })
  })

  test("a denied lane stays denied", () => {
    expect(
      planAccessAsk({ record: at(STATES.denied), host: "pop", now: 3 }),
    ).toEqual(at(STATES.denied))
  })

  test("a starting host keeps a lane's request", () => {
    expect(
      planAccessRecovery([at(STATES.waiting), at(STATES.allowed)]),
    ).toEqual([])
  })

  test("a starting host clears a refusal for a host outside", () => {
    const refused = {
      ...at(STATES.allowed),
      outside: { host: "hql", key: "SHA256:k", at: 1 },
    }
    expect(planAccessRecovery([refused])).toEqual([at(STATES.allowed)])
  })
})

describe("planPersonalSign", () => {
  const sign = (record: AccessRecord, mayAsk = true) =>
    planPersonalSign({ record, mayAsk, host: "hql", now: 4 })

  test("an allowed lane signs; any other is refused at once", () => {
    expect(sign(at(STATES.allowed))).toEqual({ signs: true, write: null })
    for (const state of [STATES.waiting, STATES.denied])
      expect(sign(at(state))).toEqual({ signs: false, write: null })
  })

  test("a lane that never asked asks as it is refused", () => {
    expect(sign(at(null))).toEqual({
      signs: false,
      write: at({ kind: "waiting", host: "hql", since: 4 }),
    })
  })

  test("a lane that may not ask writes nothing", () => {
    for (const personal of [null, STATES.allowed])
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
    expect(change(STATES.waiting, STATES.allowed)).toEqual({
      kind: "allowed",
      host: "pop",
      owner: DUANE,
    })
    expect(change(STATES.waiting, STATES.denied)?.kind).toBe("denied")
    expect(change(STATES.denied, STATES.allowed)?.kind).toBe("allowed")
  })

  test("taking back what was allowed is taken-back news", () => {
    expect(
      change(STATES.allowed, {
        kind: "denied",
        host: "pop",
        by: DUANE,
        at: 1,
        takenBack: true,
      }),
    ).toEqual({ kind: "taken-back", host: "pop", owner: DUANE })
  })
})
