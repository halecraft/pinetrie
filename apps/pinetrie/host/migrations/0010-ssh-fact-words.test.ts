import { expect, test } from "vitest"
import { sshFactWords } from "./0010-ssh-fact-words.ts"

test("a refusal reads as denied, and a revoke as taken back", () => {
  expect(
    sshFactWords({ news: "refused", host: "hql", ownerName: "D" }),
  ).toEqual({ news: "denied", host: "hql", ownerName: "D" })
  expect(sshFactWords({ news: "revoked", host: null, ownerName: "D" })).toEqual(
    { news: "taken-back", host: null, ownerName: "D" },
  )
})

test("a request, or a fact in the new words, needs nothing", () => {
  expect(sshFactWords({ news: "asked", host: null, ownerName: "D" })).toBeNull()
  expect(
    sshFactWords({ news: "denied", host: null, ownerName: "D" }),
  ).toBeNull()
})
