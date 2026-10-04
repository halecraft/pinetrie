import {
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  rootIdFor,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  DIGEST,
  DIGEST_EVERY,
  type DigestBody,
  decodeDigestConfig,
  digestDue,
  digestOf,
  digestRequest,
  digestText,
  digestToWrite,
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
    headline: "x",
    points: [],
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

describe("digestOf and digestText", () => {
  const headline = (n: number) => Array.from({ length: n }, () => "w").join(" ")
  test.each<[string, string, DigestBody | null]>([
    [
      "a headline alone",
      "Moved offers out of core",
      {
        headline: "Moved offers out of core",
        points: [],
      },
    ],
    [
      "a headline and points, their markdown kept",
      "Moved offers out of core\n\n- `core/offers.ts` is new\n* fixtures fixed",
      {
        headline: "Moved offers out of core",
        points: ["`core/offers.ts` is new", "fixtures fixed"],
      },
    ],
    [
      "nothing to add, in any case",
      "Nothing to add.",
      {
        headline: null,
        points: [],
      },
    ],
    [
      "a bold heading, unwrapped",
      "## **Fixed the rail.**",
      {
        headline: "Fixed the rail",
        points: [],
      },
    ],
    [
      "a quoted headline, unwrapped",
      '"Fixed the rail"',
      {
        headline: "Fixed the rail",
        points: [],
      },
    ],
    [
      "a headline with a colon inside",
      "offer: scripted",
      {
        headline: "offer: scripted",
        points: [],
      },
    ],
    ["refused: a long headline", headline(15), null],
    ["refused: a fifth point", "H\n- a\n- b\n- c\n- d\n- e", null],
    ["refused: a long point", `H\n- ${headline(41)}`, null],
    ["refused: a prose second line", "H\nIt went well.", null],
    ["refused: a bullet for a headline", "- a\n- b", null],
    ["refused: an empty reply", "  \n ", null],
  ])("%s", (_, reply, body) => {
    expect(digestOf(reply)).toEqual(body)
    if (body !== null) expect(digestOf(digestText(body))).toEqual(body)
  })
  test("digestText words no headline as nothing to add", () => {
    expect(digestText({ headline: null, points: [] })).toBe("nothing to add")
    expect(digestText({ headline: "H", points: ["a", "b"] })).toBe(
      "H\n- a\n- b",
    )
  })
})

describe("digestToWrite", () => {
  const body = { headline: "Fixed the rail", points: ["a"] }
  const stored = (final: boolean) => ({
    prompt: P,
    headline: "Fixing the rail",
    points: [],
    at: 1,
    final,
  })
  test.each<
    [
      string,
      Omit<Parameters<typeof digestToWrite>[0], "prompt" | "at">,
      unknown,
    ]
  >([
    [
      "a live digest that comes back after the final one is dropped",
      { stored: stored(true), asked: { final: false }, body },
      null,
    ],
    [
      "a live one over a live one is written",
      { stored: stored(false), asked: { final: false }, body },
      { prompt: P, ...body, at: 9, final: false },
    ],
    [
      "a final one is written over the final one",
      { stored: stored(true), asked: { final: true }, body },
      { prompt: P, ...body, at: 9, final: true },
    ],
    [
      "a refused live one writes nothing",
      { stored: stored(false), asked: { final: false }, body: null },
      null,
    ],
    [
      "a refused final one writes an empty final digest",
      { stored: stored(false), asked: { final: true }, body: null },
      { prompt: P, headline: null, points: [], at: 9, final: true },
    ],
  ])("%s", (_, input, written) => {
    expect(digestToWrite({ ...input, prompt: P, at: 9 })).toEqual(written)
  })
})

test("the record round-trips; a malformed one, or one stored as text, is dropped", () => {
  const r = {
    prompt: P,
    headline: "Fixing the rail",
    points: ["`rail.tsx`"],
    at: 3,
    final: false,
  }
  expect(DIGEST.decode(structuredClone(DIGEST.encode(r)), P)).toEqual(r)
  const none = { ...r, headline: null, points: [] }
  expect(DIGEST.decode(structuredClone(DIGEST.encode(none)), P)).toEqual(none)
  expect(DIGEST.decode({ text: "done", at: 1, final: true }, P)).toBeUndefined()
  expect([
    ...recordsOf(DIGEST, [
      setRecord(DIGEST, r, rootIdFor("test-root")),
      { key: "p-2", value: null },
    ]),
  ]).toEqual([[P, r]])
})

test("decodeDigestConfig: on unless enabled is false", () => {
  expect(decodeDigestConfig({ digests: { enabled: false } })).toBe(false)
  expect(decodeDigestConfig({ digests: { enabled: true } })).toBe(true)
  expect(decodeDigestConfig({ digests: { enabled: "no" } })).toBe(true)
  expect(decodeDigestConfig({ digests: {} })).toBe(true)
  expect(decodeDigestConfig(null)).toBe(true)
})

test("digestRequest: the ask always, the newest work that fits, the last word, and the summary so far", () => {
  const work = Array.from({ length: 50 }, (_, i) => `agent: step ${i}`)
  const { system, user } = digestRequest({
    skill: "  Summarize.  ",
    ask: "Ada: fix the rail",
    work,
    shown: "agent: the rail is fixed",
    previous: "Reading the rail",
    budget: 400,
  })
  expect(system).toBe("Summarize.")
  expect(user).toContain("Ada: fix the rail")
  expect(user).toContain("step 49")
  expect(user).not.toContain("step 0\n")
  expect(user).toContain("earlier left out")
  expect(user).toContain(
    "What the reader sees after the work:\nagent: the rail is fixed",
  )
  expect(user).toContain("The summary so far:\nReading the rail")
})

test("digestRequest: the last word survives a budget too small for any work", () => {
  const { user } = digestRequest({
    skill: "",
    ask: "Ada: fix the rail",
    work: ["agent: a long step"],
    shown: "agent: the rail is fixed",
    previous: null,
    budget: 10,
  })
  expect(user).toContain("agent: the rail is fixed")
  expect(user).not.toContain("a long step")
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
  // A short ask, a long chat ask, a long land ask, and a message no run
  // answered, in a line.
  const index = indexTree(
    Object.fromEntries(
      [
        at("p-0", null, { role: "chat", author: "Ada", content: "first" }),
        at("w-0", "p-0", { role: "assistant", content: "did first" }),
        at("p-1", "w-0", { role: "chat", author: "Bea", content: "second" }),
        at("w-1", "p-1", { role: "assistant", content: "reading" }),
        at("w-2", "w-1", { role: "assistant", content: "editing" }),
        at("w-3", "w-2", { role: "assistant", content: "did second" }),
        at("p-2", "w-3", { role: "land", content: "land it" }),
        at("w-4", "p-2", { role: "assistant", content: "rebasing" }),
        at("w-5", "w-4", { role: "assistant", content: "testing" }),
        at("w-6", "w-5", { role: "assistant", content: "landed" }),
        at("p-3", "w-6", { role: "chat", author: "Ada", content: "thanks" }),
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

  test("an ask's own message and only its work, its last word apart", () => {
    expect(plan("p-1")).toEqual({
      final: true,
      said: "Bea: second",
      work: ["agent: reading", "agent: editing"],
      shown: "agent: did second",
      previous: null,
    })
  })

  test("a land ask is its own message", () => {
    expect(plan("p-2")).toMatchObject({
      said: "land: land it",
      work: ["agent: rebasing", "agent: testing"],
      shown: "agent: landed",
    })
  })

  test("the summary so far is worded as the model answers", () => {
    expect(
      plan("p-1", {
        ended: false,
        reading: true,
        now: DIGEST_EVERY,
        stored: {
          prompt: P,
          headline: "Reading",
          points: ["`a.ts`"],
          at: 0,
          final: false,
        },
      })?.previous,
    ).toBe("Reading\n- `a.ts`")
  })

  test("a short ask, no work, or not due, is no plan", () => {
    expect(plan("p-0")).toBeNull()
    expect(plan("p-0", { ended: false, reading: true })).toBeNull()
    expect(plan("p-3")).toBeNull()
    expect(
      plan("p-1", {
        stored: { prompt: P, headline: "done", points: [], at: 0, final: true },
      }),
    ).toBeNull()
  })
})
