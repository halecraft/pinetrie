import {
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  rootIdFor,
} from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  DIGEST_EVERY,
  type DigestBody,
  type DigestRecord,
  digestDue,
  HEADLINE_WORDS,
  MAX_POINTS,
  POINT_WORDS,
} from "./digest.ts"
import {
  DIGEST,
  decodeRecords,
  deleteRecord,
  digestRequest,
  digestText,
  digestToWrite,
  parseDigest,
  planDigest,
  setRecord,
} from "./index.ts"

const P = entryId("p-1")
const ROOT = rootIdFor("test-root")

describe("digestDue", () => {
  const base = {
    ended: false,
    stored: undefined,
    inFlight: false,
    reading: true,
    now: 100_000,
  }
  const live: DigestRecord = {
    prompt: P,
    headline: "x",
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
      { ended: true, stored: { ...live, points: [], final: true } },
      false,
    ],
  ])("%s", (_, over, due) => {
    expect(digestDue({ ...base, ...over })).toBe(due)
  })
})

describe("parseDigest and digestText", () => {
  const words = (n: number) => Array.from({ length: n }, () => "w").join(" ")
  const list = (n: number) =>
    Array.from({ length: n }, (_, i) => `- point ${i}`).join("\n")
  test.each<[string, string, DigestBody | null]>([
    [
      "a headline alone",
      "Moved proposed changes out of core",
      {
        headline: "Moved proposed changes out of core",
        points: [],
      },
    ],
    [
      "a headline and points, their markdown kept",
      "Moved proposed changes out of core\n\n- `core/proposed.ts` is new\n* fixtures fixed",
      {
        headline: "Moved proposed changes out of core",
        points: ["`core/proposed.ts` is new", "fixtures fixed"],
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
      "proposed changes: scripted",
      {
        headline: "proposed changes: scripted",
        points: [],
      },
    ],
    [
      "a headline and points at their limits",
      `${words(HEADLINE_WORDS)}\n${list(MAX_POINTS - 1)}\n- ${words(POINT_WORDS)}`,
      {
        headline: words(HEADLINE_WORDS),
        points: [
          ...Array.from({ length: MAX_POINTS - 1 }, (_, i) => `point ${i}`),
          words(POINT_WORDS),
        ],
      },
    ],
    ["refused: a long headline", words(HEADLINE_WORDS + 1), null],
    ["refused: a point too many", `H\n${list(MAX_POINTS + 1)}`, null],
    ["refused: a long point", `H\n- ${words(POINT_WORDS + 1)}`, null],
    ["refused: a prose second line", "H\nIt went well.", null],
    ["refused: a bullet for a headline", "- a\n- b", null],
    ["refused: an empty reply", "  \n ", null],
  ])("%s", (_, reply, body) => {
    expect(parseDigest(reply)).toEqual(body)
    if (body !== null) expect(parseDigest(digestText(body))).toEqual(body)
  })
  test("a reply of nothing to add is refused", () => {
    expect(parseDigest("Nothing to add.")).toBeNull()
    expect(parseDigest("nothing to add")).toBeNull()
  })
  test("digestText words a live digest as its headline alone", () => {
    expect(digestText({ headline: "H", points: ["a", "b"] })).toBe(
      "H\n- a\n- b",
    )
    expect(digestText({ prompt: P, headline: "H", at: 1, final: false })).toBe(
      "H",
    )
  })
})

describe("digestToWrite", () => {
  const body = { headline: "Fixed the rail", points: ["a"] }
  const stored = (final: boolean): DigestRecord =>
    final
      ? { prompt: P, headline: "Fixed it", points: [], at: 1, final }
      : { prompt: P, headline: "Fixing the rail", at: 1, final }
  const write = (
    input: Omit<Parameters<typeof digestToWrite>[0], "prompt" | "root" | "at">,
  ) => digestToWrite({ ...input, prompt: P, root: ROOT, at: 9 })
  test.each<
    [
      string,
      Omit<Parameters<typeof digestToWrite>[0], "prompt" | "root" | "at">,
      DigestRecord | null,
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
      { prompt: P, headline: body.headline, at: 9, final: false },
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
  ])("%s", (_, input, written) => {
    expect(write(input)).toEqual(
      written === null ? null : setRecord(DIGEST, written, ROOT),
    )
  })
  test("a live digest is written without points", () => {
    const written = write({ stored: undefined, asked: { final: false }, body })
    expect(written?.kind === "set" && written.value).toEqual({
      headline: body.headline,
      at: 9,
      final: false,
    })
  })
  test("a refused final reply deletes the live digest", () => {
    expect(
      write({ stored: stored(false), asked: { final: true }, body: null }),
    ).toEqual(deleteRecord(DIGEST, P, ROOT))
    expect(
      write({ stored: undefined, asked: { final: true }, body: null }),
    ).toBeNull()
  })
})

test("the record round-trips; a malformed one, or one stored as text, is dropped", () => {
  const r: DigestRecord = {
    prompt: P,
    headline: "Fixed the rail",
    points: ["`rail.tsx`"],
    at: 3,
    final: true,
  }
  expect(DIGEST.decode(structuredClone(DIGEST.encode(r)), P)).toEqual(r)
  const live: DigestRecord = {
    prompt: P,
    headline: "Fixing",
    at: 3,
    final: false,
  }
  expect(DIGEST.decode(structuredClone(DIGEST.encode(live)), P)).toEqual(live)
  expect(DIGEST.decode({ text: "done", at: 1, final: true }, P)).toBeUndefined()
  expect([
    ...decodeRecords(DIGEST, [
      setRecord(DIGEST, r, ROOT),
      { key: "p-2", value: null },
    ]),
  ]).toEqual([[P, r]])
})

test("digestRequest: the ask always, the newest work that fits, the last word, and the summary so far", () => {
  const work = Array.from({ length: 50 }, (_, i) => `agent: step ${i}`)
  const { system, user } = digestRequest({
    answer: "digest",
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
    answer: "digest",
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
    thread: FIXTURE_THREAD,
    type: "message",
    message,
  })
  // A short ask, a long chat ask, a long land ask, and a message no run
  // answered, in a line.
  const index = indexTree(
    Object.fromEntries(
      [
        at("p-0", null, { role: "person", author: "Ada", content: "first" }),
        at("w-0", "p-0", { role: "assistant", content: "did first" }),
        at("p-1", "w-0", { role: "person", author: "Bea", content: "second" }),
        at("w-1", "p-1", { role: "assistant", content: "reading" }),
        at("w-2", "w-1", { role: "assistant", content: "editing" }),
        at("w-3", "w-2", { role: "assistant", content: "did second" }),
        at("p-2", "w-3", { role: "land", content: "land it" }),
        at("w-4", "p-2", { role: "assistant", content: "rebasing" }),
        at("w-5", "w-4", { role: "assistant", content: "testing" }),
        at("w-6", "w-5", { role: "assistant", content: "landed" }),
        at("p-3", "w-6", { role: "person", author: "Ada", content: "thanks" }),
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

  test("the summary so far is worded as the model answers: a live one, its headline", () => {
    expect(
      plan("p-1", {
        ended: false,
        reading: true,
        now: DIGEST_EVERY,
        stored: { prompt: P, headline: "Reading", at: 0, final: false },
      })?.previous,
    ).toBe("Reading")
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

test("an old digest, or a live one with points, does not decode", () => {
  expect(
    DIGEST.decode({ headline: null, points: [], at: 1, final: true }, P),
  ).toBeUndefined()
  expect(
    DIGEST.decode({ headline: "H", points: ["a"], at: 1, final: false }, P),
  ).toBeUndefined()
})
