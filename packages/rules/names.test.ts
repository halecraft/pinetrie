import { ADJECTIVES, NOUNS, type ThreadName, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  NAME,
  planNames,
  planReserve,
  recordsOf,
  setRecord,
  threadNameOf,
} from "./index.ts"
import { threadNameFor } from "./names.ts"

const lane = (id: string) => threadIdFor(id)
const A = lane("01a0ed41-5f73-7461-b1ae-4572a17a15f3")
const B = lane("01a0ed45-4157-7461-b1ae-45f9bfeb4818")

describe("the word lists", () => {
  test("256 each, lowercase, 3 to 7 letters, no word in both", () => {
    expect(ADJECTIVES.length).toBe(256)
    expect(NOUNS.length).toBe(256)
    expect(new Set(ADJECTIVES).size).toBe(256)
    expect(new Set(NOUNS).size).toBe(256)
    for (const w of [...ADJECTIVES, ...NOUNS]) expect(w).toMatch(/^[a-z]{3,7}$/)
    const nouns = new Set<string>(NOUNS)
    expect(ADJECTIVES.filter(w => nouns.has(w))).toEqual([])
  })
})

describe("threadNameFor", () => {
  test("stable, two words, and different for ids a minute apart", () => {
    const a = threadNameFor(A, new Set())
    expect(threadNameFor(A, new Set())).toBe(a)
    expect(a).toMatch(/^[a-z]+-[a-z]+$/)
    expect(threadNameFor(B, new Set())).not.toBe(a)
  })
  test("a name in use moves to the next free pair", () => {
    const first = threadNameFor(A, new Set())
    const second = threadNameFor(A, new Set([first]))
    expect(second).not.toBe(first)
    expect(threadNameFor(A, new Set([second]))).toBe(first)
  })
  test("every pair of the first choice's adjective in use: another adjective", () => {
    const first = threadNameFor(A, new Set())
    const adjective = first.split("-")[0]
    const all = new Set(NOUNS.map(n => `${adjective}-${n}`))
    expect(threadNameFor(A, all).split("-")[0]).not.toBe(adjective)
  })
})

test("threadNameOf: a lane's name, else its id's last eight characters", () => {
  const named = new Map([[A, "amber-fox" as ThreadName]])
  expect(threadNameOf(named, A)).toBe("amber-fox")
  expect(threadNameOf(named, B)).toBe(B.slice(-8))
})

describe("planNames", () => {
  test("names only the unnamed, oldest first, never two alike", () => {
    const named = new Map([[A, "amber-fox" as ThreadName]])
    const C = lane("c")
    const planned = planNames(
      [
        { lane: C, createdAt: 3 },
        { lane: A, createdAt: 1 },
        { lane: B, createdAt: 2 },
      ],
      named,
      9,
    )
    expect(planned.map(r => r.lane)).toEqual([B, C])
    expect(planned.every(r => r.at === 9)).toBe(true)
    expect(new Set(planned.map(r => r.name)).size).toBe(2)
    expect(planned.map(r => r.name)).not.toContain("amber-fox")
  })
  test("two lanes whose first choice is the same get different names", () => {
    const wanted = threadNameFor(A, new Set())
    let twin = lane("0")
    for (let i = 1; threadNameFor(twin, new Set()) !== wanted; i += 1)
      twin = lane(String(i))
    const planned = planNames(
      [
        { lane: twin, createdAt: 2 },
        { lane: A, createdAt: 1 },
      ],
      new Map(),
      0,
    )
    expect(planned.map(r => r.name)).toEqual([
      wanted,
      threadNameFor(twin, new Set([wanted])),
    ])
    expect(planned[1]?.name).not.toBe(wanted)
  })
})

describe("planReserve", () => {
  const named = new Map([[A, "amber-fox" as ThreadName]])
  test("an id already named is known, and one pi holds is refused", () => {
    expect(planReserve(A, new Set(), named, 5)).toEqual({ kind: "known" })
    expect(planReserve(B, new Set([B]), named, 5)).toEqual({ kind: "held" })
  })
  test("any other id is named as a lane would be, avoiding every stored name", () => {
    const plan = planReserve(B, new Set([A]), named, 5)
    expect(plan).toEqual({
      kind: "name",
      record: planNames([{ lane: B, createdAt: 5 }], named, 5)[0],
    })
    expect(plan.kind === "name" && plan.record.name).not.toBe("amber-fox")
  })
})

test("a name record round-trips by lane; a malformed name is dropped", () => {
  const e = setRecord(NAME, { lane: A, name: "amber-fox" as ThreadName, at: 1 })
  expect([e.namespace, e.key]).toEqual(["pinetrie.name", A])
  expect(recordsOf(NAME, [e]).get(A)?.name).toBe("amber-fox")
  expect(
    recordsOf(NAME, [{ key: B, value: { name: "Amber Fox", at: 1 } }]).size,
  ).toBe(0)
  // A name keyed by what is no lane is dropped.
  expect(recordsOf(NAME, [{ ...e, key: "main" }]).size).toBe(0)
})
