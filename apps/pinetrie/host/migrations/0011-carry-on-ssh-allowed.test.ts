import { expect, test } from "vitest"
import { carryOnSshAllowed } from "./0011-carry-on-ssh-allowed.ts"

const BASE = { lane: "t-1", by: "d", name: "Duane" }

test("a carry-on an approval woke reads as one an allowance woke", () => {
  expect(
    carryOnSshAllowed({
      ...BASE,
      reason: { kind: "ssh-approved", host: "hql" },
    }),
  ).toEqual({ ...BASE, reason: { kind: "ssh-allowed", host: "hql" } })
})

test("a stop's carry-on, or one already renamed, needs nothing", () => {
  expect(carryOnSshAllowed({ ...BASE, reason: { kind: "stopped" } })).toBeNull()
  expect(
    carryOnSshAllowed({ ...BASE, reason: { kind: "ssh-allowed", host: null } }),
  ).toBeNull()
})
