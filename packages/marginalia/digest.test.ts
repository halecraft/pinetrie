import { type EntryLike, entryId, indexAsks, indexTree } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  DIGEST,
  DIGEST_EVERY,
  decodeDigestConfig,
  digestDue,
  digestRequest,
  digestStillWanted,
  planDigest,
  recordsOf,
  setRecord,
} from "./index.ts"

const P = entryId("p-1")

describe("digestDue", () => {
  const base = {
    ended: false,
    stored: undefined,
    inFlight: false,
    reading: true,
    now: 100_000,
  }
  const live = {
    prompt: P,
    text: "x",
    at: 100_000 - DIGEST_EVERY,
    final: false,
  }
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
  const final = { prompt: P, text: "done", at: 1, final: true }
  expect(digestStillWanted(final, { final: false })).toBe(false)
  expect(digestStillWanted(final, { final: true })).toBe(true)
  expect(digestStillWanted(undefined, { final: false })).toBe(true)
  expect(digestStillWanted({ ...final, final: false }, { final: false })).toBe(
    true,
  )
})

test("the record round-trips; a malformed one is dropped", () => {
  const r = { prompt: P, text: "Fixing the rail.", at: 3, final: false }
  expect(DIGEST.decode(structuredClone(DIGEST.encode(r)), P)).toEqual(r)
  expect(DIGEST.decode({ text: 1 }, P)).toBeUndefined()
  expect([
    ...recordsOf(DIGEST, [setRecord(DIGEST, r), { key: "p-2", value: null }]),
  ]).toEqual([[P, r]])
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

describe("planDigest", () => {
  const at = (
    id: string,
    parentId: string | null,
    message: Record<string, unknown>,
  ): EntryLike => ({
    id: entryId(id),
    parentId: parentId === null ? null : entryId(parentId),
    type: "message",
    message,
  })
  // Two chat asks, a land ask, and a message no run answered, in a line.
  const index = indexTree(
    Object.fromEntries(
      [
        at("p-0", null, { role: "chat", author: "Ada", content: "first" }),
        at("w-0", "p-0", { role: "assistant", content: "did first" }),
        at("p-1", "w-0", { role: "chat", author: "Bea", content: "second" }),
        at("w-1", "p-1", { role: "assistant", content: "reading" }),
        at("w-2", "w-1", { role: "assistant", content: "did second" }),
        at("p-2", "w-2", { role: "land", content: "land it" }),
        at("w-3", "p-2", { role: "assistant", content: "landed" }),
        at("p-3", "w-3", { role: "chat", author: "Ada", content: "thanks" }),
      ].map(e => [e.id, e]),
    ),
  )
  const asks = indexAsks(index)
  const plan = (
    ask: string,
    over: Partial<Parameters<typeof planDigest>[0]> = {},
  ) =>
    planDigest({
      index,
      asks,
      ask: entryId(ask),
      ended: true,
      stored: undefined,
      inFlight: false,
      reading: false,
      now: 0,
      ...over,
    })

  test("an ask's own message and only its work", () => {
    expect(plan("p-1")).toEqual({
      final: true,
      said: "Bea: second",
      work: ["agent: reading", "agent: did second"],
      previous: null,
    })
  })

  test("a land ask is its own message", () => {
    expect(plan("p-2")).toMatchObject({
      said: "land: land it",
      work: ["agent: landed"],
    })
  })

  test("no work, or not due, is no plan", () => {
    expect(plan("p-3")).toBeNull()
    expect(
      plan("p-1", {
        stored: { prompt: P, text: "done", at: 0, final: true },
      }),
    ).toBeNull()
  })
})
