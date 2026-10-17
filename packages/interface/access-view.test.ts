import {
  type AccessRecord,
  type PersonalAccess,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { emptyAccess } from "@pinetrie/rules"
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
})

describe("the owner", () => {
  test("is asked for their ssh by host, and answers approve or refuse", () => {
    expect(row(at(WAITING))).toEqual({
      line: "🔑 wants your ssh for pop",
      answers: [
        { answer: "approve", label: "approve" },
        { answer: "refuse", label: "refuse" },
      ],
      waiting: false,
      note: null,
    })
  })

  test("can take an approval back, and approve after a refusal", () => {
    expect(
      row(at({ kind: "approved", by: DUANE, at: 1 }, { hosts: ["pop"] })),
    ).toMatchObject({
      line: "🔑 your ssh · pop",
      answers: [{ answer: "revoke", label: "revoke" }],
    })
    expect(
      row(at({ kind: "refused", by: DUANE, at: 1, revoked: true }))?.answers,
    ).toEqual([{ answer: "approve", label: "approve" }])
  })
})

describe("everyone else", () => {
  test("sees whom the lane waits for, and no answer to give", () => {
    expect(row(at(WAITING), BEA)).toMatchObject({
      line: "🔑 waiting for Duane",
      answers: [],
    })
  })

  test("sees whose ssh it holds, refused, revoked or unanswered", () => {
    expect(row(at({ kind: "approved", by: DUANE, at: 1 }), BEA)?.line).toBe(
      "🔑 Duane's ssh",
    )
    expect(
      row(at({ kind: "refused", by: DUANE, at: 1, revoked: false }), BEA)?.line,
    ).toBe("🔑 Duane's ssh refused")
    expect(
      row(at({ kind: "refused", by: DUANE, at: 1, revoked: true }), BEA)?.line,
    ).toBe("🔑 Duane's ssh revoked")
    expect(row(at({ kind: "unanswered", host: null, at: 1 }), BEA)?.line).toBe(
      "🔑 Duane's ssh: no answer for a host",
    )
  })
})

test("service identities come first, with the hosts the lane reached", () => {
  expect(
    row(
      at(
        { kind: "approved", by: DUANE, at: 1 },
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
    accessWords(view, { kind: "sent", id: "1", action: "approve", to: null })
      .waiting,
  ).toBe(true)
  expect(
    accessWords(view, {
      kind: "refused",
      code: "not_owner",
      action: "approve",
      message: "only this host's owner answers",
    }).note,
  ).toBe("not done: only this host's owner answers")
})
