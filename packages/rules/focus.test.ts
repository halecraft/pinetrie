import { type EntryLike, entryId, indexAsks, indexTree } from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { DigestRecord } from "./digest.ts"
import type { FocusRecord } from "./focus.ts"
import {
  FOCUS,
  FOCUS_REQUEST_HEAD,
  FOCUS_WORDS,
  focusRequest,
  focusToWrite,
  parseFocus,
  planFocus,
} from "./focus.ts"

const T = FIXTURE_THREAD
const at = (
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  thread: T,
  type: "message",
  message,
})

// Two asks of Ada's, each answered.
const index = indexTree(
  Object.fromEntries(
    [
      at("p-1", null, {
        role: "person",
        author: "Ada",
        content: "fix the rail",
      }),
      at("w-1", "p-1", { role: "assistant", content: "fixed" }),
      at("p-2", "w-1", {
        role: "person",
        author: "Ada",
        content: "now billing",
      }),
      at("w-2", "p-2", { role: "assistant", content: "planned" }),
    ].map(e => [e.id, e]),
  ),
)
const asks = indexAsks(index)
const stored = (ask: string, focus = "Fixing the rail"): FocusRecord => ({
  thread: T,
  focus,
  ask: entryId(ask),
  at: 1,
})
const final = (prompt: string, headline: string): DigestRecord => ({
  prompt: entryId(prompt),
  headline,
  points: [],
  at: 1,
  final: true,
})

describe("parseFocus", () => {
  const words = (n: number) => Array.from({ length: n }, () => "w").join(" ")
  test.each<[string, string, ReturnType<typeof parseFocus>]>([
    ["same, in any case", "Same.", { kind: "same" }],
    [
      "a focus, unwrapped",
      '"Planning the billing page"',
      { kind: "focus", focus: "Planning the billing page" },
    ],
    [
      "a focus at its limit",
      words(FOCUS_WORDS),
      { kind: "focus", focus: words(FOCUS_WORDS) },
    ],
    ["refused: two lines", "Billing\nand more", null],
    ["refused: empty", " ", null],
  ])("%s", (_, reply, read) => {
    expect(parseFocus(reply)).toEqual(read)
  })
  test("a focus over ten words is refused, not cut", () => {
    expect(parseFocus(words(FOCUS_WORDS + 1))).toBeNull()
  })
})

describe("focusToWrite", () => {
  const write = (
    over: Partial<Parameters<typeof focusToWrite>[0]> = {},
  ): FocusRecord | null =>
    focusToWrite({
      stored: stored("p-1"),
      reply: { kind: "focus", focus: "Planning billing" },
      thread: T,
      ask: entryId("p-2"),
      at: 9,
      ...over,
    })
  test("a new focus from a newer ask is written", () => {
    expect(write()).toEqual({
      thread: T,
      focus: "Planning billing",
      ask: entryId("p-2"),
      at: 9,
    })
  })
  test("same keeps the stored focus", () => {
    expect(write({ reply: { kind: "same" } })).toBeNull()
  })
  test("a failed or refused reply writes nothing", () => {
    expect(write({ reply: null })).toBeNull()
  })
  test("the stored focus's own words write nothing", () => {
    expect(
      write({ reply: { kind: "focus", focus: "Fixing the rail" } }),
    ).toBeNull()
  })
  test("an older run's focus never replaces a newer one's", () => {
    expect(write({ stored: stored("p-3"), ask: entryId("p-2") })).toBeNull()
  })
})

describe("planFocus and focusRequest", () => {
  const plan = (over: Partial<Parameters<typeof planFocus>[0]> = {}) =>
    planFocus({
      enabled: true,
      index,
      asks,
      thread: T,
      digests: new Map([[entryId("p-1"), final("p-1", "Fixed the rail")]]),
      settled: { ask: entryId("p-2"), digest: final("p-2", "Planned billing") },
      stored: stored("p-1"),
      ...over,
    })
  test("the request lists the first ask and the newest, each with its headline", () => {
    const planned = plan()
    expect(planned).toEqual({
      focus: "Fixing the rail",
      asks: [
        { said: "Ada: fix the rail", headline: "Fixed the rail" },
        { said: "Ada: now billing", headline: "Planned billing" },
      ],
    })
    if (planned === null) throw new Error("no plan")
    const { system, user } = focusRequest({
      skill: " Name it. ",
      plan: planned,
      budget: 4_000,
    })
    expect(system).toBe("Name it.")
    expect(user.startsWith(`${FOCUS_REQUEST_HEAD} Fixing the rail\n`)).toBe(
      true,
    )
    expect(user).toContain(
      "- Ada: fix the rail\n  (came of it: Fixed the rail)\n",
    )
    expect(user).toContain(
      "- Ada: now billing\n  (came of it: Planned billing)\n",
    )
  })
  test("the settled run's digest is its ask's, over the root's", () => {
    expect(
      plan({ settled: { ask: entryId("p-2"), digest: null } })?.asks[1],
    ).toEqual({ said: "Ada: now billing", headline: null })
  })
  test("a thread with no focus yet says so", () => {
    const planned = plan({ stored: undefined })
    if (planned === null) throw new Error("no plan")
    expect(
      focusRequest({ skill: "", plan: planned, budget: 4_000 }).user,
    ).toContain(`${FOCUS_REQUEST_HEAD} (none yet)`)
  })
  test("digests off, or a thread with no ask, asks nothing", () => {
    expect(plan({ enabled: false })).toBeNull()
    expect(
      plan({ index: indexTree({}), asks: indexAsks(indexTree({})) }),
    ).toBeNull()
  })
})

test("the record round-trips; a malformed one is dropped", () => {
  const r = stored("p-1")
  expect(FOCUS.decode(structuredClone(FOCUS.encode(r)), T)).toEqual(r)
  expect(FOCUS.decode({ focus: "", ask: "p-1", at: 1 }, T)).toBeUndefined()
})
