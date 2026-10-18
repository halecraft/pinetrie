import { threadIdFor, writerId } from "@pinetrie/core"
import {
  type AccessRecord,
  emptyAccess,
  type PersonalAccess,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { accessView, accessWords } from "./access-view.ts"

const LANE = threadIdFor("t-1")
const DUANE = writerId("duane@x.io")
const BEA = writerId("bea@x.io")
const NAMES = new Map([[DUANE, "Duane"]])

const at = (
  personal: PersonalAccess | null,
  over: Partial<AccessRecord> = {},
): AccessRecord => ({ ...emptyAccess(LANE), personal, ...over })

const row = (record: AccessRecord | undefined, me = DUANE) => {
  const view = accessView({ record, owner: DUANE, me, nameOf: NAMES })
  return view === null ? null : accessWords(view)
}

const WAITING: PersonalAccess = { kind: "waiting", host: "pop", since: 1 }

test("a lane that never asked and used nothing has no row", () => {
  expect(row(undefined)).toBeNull()
  expect(row(at(null))).toBeNull()
  expect(row(at(null, { hosts: ["pop"] }))).toBeNull()
})

test("a lane refused only for a host outside has a row", () => {
  expect(
    row(at(null, { outside: { host: "hql", key: "SHA256:k", at: 1 } })),
  ).toEqual({
    line: "🔑 your ssh can't sign for hql: outside lanes.ssh.hosts",
    answers: [],
    waiting: false,
    note: null,
  })
})

describe("the owner", () => {
  test("is asked for their ssh by host, and answers allow or deny", () => {
    expect(row(at(WAITING))).toEqual({
      line: "🔑 asks to use your ssh for pop",
      answers: [
        { answer: "allow", label: "allow" },
        { answer: "deny", label: "deny" },
      ],
      waiting: false,
      note: null,
    })
  })

  test("can take an allowance back, and allow after a denial", () => {
    expect(
      row(
        at(
          { kind: "allowed", host: "pop", by: DUANE, at: 1 },
          { hosts: ["pop"] },
        ),
      ),
    ).toMatchObject({
      line: "🔑 your ssh · pop",
      answers: [{ answer: "take-back", label: "take back" }],
    })
    expect(
      row(
        at({ kind: "denied", host: "pop", by: DUANE, at: 1, takenBack: true }),
      )?.answers,
    ).toEqual([{ answer: "allow", label: "allow" }])
  })
})

describe("everyone else", () => {
  test("sees whom the lane waits for, and no answer to give", () => {
    expect(row(at(WAITING), BEA)).toMatchObject({
      line: "🔑 waiting for Duane",
      answers: [],
    })
  })

  test("sees whose ssh it holds, denied or taken back", () => {
    expect(
      row(at({ kind: "allowed", host: "pop", by: DUANE, at: 1 }), BEA)?.line,
    ).toBe("🔑 Duane's ssh")
    expect(
      row(
        at({ kind: "denied", host: "pop", by: DUANE, at: 1, takenBack: false }),
        BEA,
      )?.line,
    ).toBe("🔑 Duane's ssh denied")
    expect(
      row(
        at({ kind: "denied", host: "pop", by: DUANE, at: 1, takenBack: true }),
        BEA,
      )?.line,
    ).toBe("🔑 Duane's ssh taken back")
  })
})

test("service identities come first, with the hosts the lane reached", () => {
  expect(
    row(
      at(
        { kind: "allowed", host: "pop", by: DUANE, at: 1 },
        { services: ["deploy"], hosts: ["git.internal", "pop"] },
      ),
      BEA,
    )?.line,
  ).toBe("🔑 deploy, Duane's ssh · git.internal, pop")
})

test("an answer out makes the buttons wait; a refused one is said", () => {
  const view = accessView({
    record: at(WAITING),
    owner: DUANE,
    me: DUANE,
    nameOf: NAMES,
  })
  if (view === null) throw new Error("a waiting lane has a row")
  expect(
    accessWords(view, { kind: "sent", id: "1", action: "allow", to: null })
      .waiting,
  ).toBe(true)
  expect(
    accessWords(view, {
      kind: "refused",
      code: "not_owner",
      action: "allow",
      message: "only this host's owner answers",
    }).note,
  ).toBe("not done: only this host's owner answers")
})
