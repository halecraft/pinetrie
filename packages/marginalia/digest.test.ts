import { describe, expect, test } from "vitest"
import {
  DIGEST_EVERY,
  decodeDigest,
  decodeDigestConfig,
  digestDue,
  digestRecords,
  digestRequest,
  digestStillWanted,
  encodeDigest,
} from "./index.ts"

describe("digestDue", () => {
  const base = {
    ended: false,
    stored: undefined,
    inFlight: false,
    reading: true,
    now: 100_000,
  }
  const live = { text: "x", at: 100_000 - DIGEST_EVERY, final: false }
  test.each<[string, Partial<Parameters<typeof digestDue>[0]>, boolean]>([
    ["while it runs and someone reads it, the first", {}, true],
    ["no one reading it, none", { reading: false }, false],
    ["one asked already, none", { inFlight: true }, false],
    ["a minute after the last, another", { stored: live }, true],
    ["sooner, none", { stored: { ...live, at: 99_000 } }, false],
    [
      "at the end, the final one, read or not",
      { ended: true, reading: false },
      true,
    ],
    [
      "never once the final one is written",
      { ended: true, stored: { ...live, final: true } },
      false,
    ],
  ])("%s", (_, over, due) => {
    expect(digestDue({ ...base, ...over })).toBe(due)
  })
})

test("digestStillWanted: a live digest that comes back after the final one is dropped", () => {
  const final = { text: "done", at: 1, final: true }
  expect(digestStillWanted(final, { final: false })).toBe(false)
  expect(digestStillWanted(final, { final: true })).toBe(true)
  expect(digestStillWanted(undefined, { final: false })).toBe(true)
  expect(digestStillWanted({ ...final, final: false }, { final: false })).toBe(
    true,
  )
})

test("the record round-trips; a malformed one is dropped", () => {
  const r = { text: "Fixing the rail.", at: 3, final: false }
  expect(decodeDigest(structuredClone(encodeDigest(r)))).toEqual(r)
  expect(decodeDigest({ text: 1 })).toBeUndefined()
  expect([
    ...digestRecords([
      { key: "p1", value: encodeDigest(r) },
      { key: "p2", value: null },
    ]),
  ]).toEqual([["p1", r]])
})

test("decodeDigestConfig: on only when enabled is true", () => {
  expect(decodeDigestConfig({ digests: { enabled: true } })).toBe(true)
  expect(decodeDigestConfig({ digests: { enabled: "yes" } })).toBe(false)
  expect(decodeDigestConfig(null)).toBe(false)
})

test("digestRequest: the ask always, the newest work that fits, and the summary so far", () => {
  const work = Array.from({ length: 50 }, (_, i) => `agent: step ${i}`)
  const { system, user } = digestRequest({
    skill: "  Summarize.  ",
    ask: "Ada: fix the rail",
    work,
    previous: "Reading the rail.",
    budget: 400,
  })
  expect(system).toBe("Summarize.")
  expect(user).toContain("Ada: fix the rail")
  expect(user).toContain("step 49")
  expect(user).not.toContain("step 0\n")
  expect(user).toContain("earlier left out")
  expect(user).toContain("The summary so far:\nReading the rail.")
})
