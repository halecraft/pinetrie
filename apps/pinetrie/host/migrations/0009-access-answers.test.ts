import { expect, test } from "vitest"
import { accessAnswers } from "./0009-access-answers.ts"

const RECORD = { outside: null, services: [], hosts: [] }

test("an approval reads as allowed, a refusal as denied, a revoke as taken back", () => {
  expect(
    accessAnswers({
      ...RECORD,
      personal: { kind: "approved", host: "pop", by: "d", at: 1 },
    }),
  ).toEqual({
    ...RECORD,
    personal: { kind: "allowed", host: "pop", by: "d", at: 1 },
  })
  expect(
    accessAnswers({
      ...RECORD,
      personal: { kind: "refused", host: "pop", by: "d", at: 1, revoked: true },
    }),
  ).toEqual({
    ...RECORD,
    personal: { kind: "denied", host: "pop", by: "d", at: 1, takenBack: true },
  })
})

test("a record with no answer, or one in the new words, needs nothing", () => {
  expect(accessAnswers({ ...RECORD, personal: null })).toBeNull()
  expect(
    accessAnswers({
      ...RECORD,
      personal: { kind: "waiting", host: null, since: 1 },
    }),
  ).toBeNull()
  expect(
    accessAnswers({
      ...RECORD,
      personal: {
        kind: "denied",
        host: "pop",
        by: "d",
        at: 1,
        takenBack: false,
      },
    }),
  ).toBeNull()
})
