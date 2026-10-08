import {
  atEntry,
  type EntryLike,
  entryId,
  indexTree,
  type LaneRecord,
  laneNameForThread,
  type MarkRecord,
  ROOT,
  rootIdFor,
  THE_AGENT,
  type TreeIndex,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  decodeTitleConfig,
  planTitling,
  titleOf,
  titleRequest,
  titleStillWanted,
} from "./index.ts"

const ADA = writerId("ada@example.com")
const R = rootIdFor("1")
const OTHER = rootIdFor("2")
const L1 = laneNameForThread("1")
const L2 = laneNameForThread("2")

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
const indexOf = (...entries: EntryLike[]): TreeIndex =>
  indexTree(Object.fromEntries(entries.map(e => [e.id, e])))

// A root that began as a chat, then a branch off its first message.
const chat = indexOf(
  at("c-0", null, { role: "chat", author: "Ada", content: "the rail" }),
  at("c-1", "c-0", { role: "chat", author: "Bea", content: "too tall" }),
  at("c-2", "c-0", { role: "chat", author: "Bea", content: "newest" }),
)
const lane = (l: typeof L1, root = R): LaneRecord => ({
  lane: l,
  root,
  ownCopy: false,
  by: ADA,
  createdAt: 0,
})
const mark: MarkRecord = {
  entry: entryId("c-0"),
  title: "Rail",
  by: ADA,
  at: 1,
}

describe("decodeTitleConfig: titles, on unless enabled is false, total", () => {
  test("on, with the run's model, unless turned off", () => {
    for (const json of [null, {}, { titles: 3 }, { titles: { enabled: 1 } }])
      expect(decodeTitleConfig(json)).toEqual({ enabled: true, model: null })
    expect(decodeTitleConfig({ titles: { enabled: false } }).enabled).toBe(
      false,
    )
  })
  test("a model is provider/id; a malformed one is the run's", () => {
    expect(
      decodeTitleConfig({ titles: { model: "anthropic/claude-haiku-4-5" } })
        .model,
    ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" })
    expect(decodeTitleConfig({ titles: { model: "haiku" } }).model).toBeNull()
  })
})

describe("planTitling", () => {
  const started = {
    kind: "lane" as const,
    lane: L1,
    at: ROOT,
    prompt: { author: "Ada", text: "fix the rail" },
  }
  const plan = (over: Partial<Parameters<typeof planTitling>[0]> = {}) =>
    planTitling({
      index: indexOf(),
      root: R,
      marks: new Map(),
      lanes: [lane(L1)],
      trigger: started,
      enabled: true,
      inFlight: false,
      ...over,
    })

  test("a new root's first lane: its prompt, as the agent", () => {
    expect(plan()).toEqual({
      kind: "ask",
      lines: ["Ada: fix the rail"],
      by: THE_AGENT,
    })
  })

  test("a lane joining a chat: the messages above it, then its prompt", () => {
    expect(
      plan({
        index: chat,
        trigger: { ...started, at: atEntry(entryId("c-1")) },
      }),
    ).toMatchObject({
      lines: ["Ada: the rail", "Bea: too tall", "Ada: fix the rail"],
    })
  })

  test("only the root's first lane; another root's lanes do not count", () => {
    expect(plan({ lanes: [lane(L2), lane(L1)] })).toEqual({ kind: "skip" })
    expect(plan({ lanes: [lane(L2, OTHER), lane(L1)] }).kind).toBe("ask")
  })

  test("nothing when off, titled already, or asked already", () => {
    expect(plan({ enabled: false })).toEqual({ kind: "skip" })
    expect(plan({ inFlight: true })).toEqual({ kind: "skip" })
    expect(plan({ index: chat, marks: new Map([[mark.entry, mark]]) })).toEqual(
      { kind: "skip" },
    )
  })

  test("asked: the path to the newest message, whatever is stored, as the person", () => {
    expect(
      plan({
        index: chat,
        marks: new Map([[mark.entry, mark]]),
        lanes: [lane(L2), lane(L1)],
        enabled: false,
        inFlight: true,
        trigger: { kind: "asked", by: ADA },
      }),
    ).toEqual({
      kind: "ask",
      lines: ["Ada: the rail", "Bea: newest"],
      by: ADA,
    })
  })

  test("asked, with no message yet: refused", () => {
    expect(plan({ trigger: { kind: "asked", by: ADA } }).kind).toBe("refused")
  })
})

test("titleRequest: the first line always, then the newest that fit", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `Ada: line ${i}`)
  const { system, user } = titleRequest({
    skill: "  Title it.  ",
    lines,
    budget: 300,
  })
  expect(system).toBe("Title it.")
  expect(user).toContain("How it began:\n- Ada: line 0\n")
  expect(user).toContain("- Ada: line 39\n")
  expect(user).not.toContain("line 1\n")
  expect(user).toMatch(/earlier left out/)
  expect(
    titleRequest({ skill: "", lines: ["Ada: hi"], budget: 300 }).user,
  ).toBe("How it began:\n- Ada: hi\n\n")
})

describe("titleOf", () => {
  test("bare words, without quotes or trailing punctuation", () => {
    expect(titleOf(" Rail layout ")).toBe("Rail layout")
    expect(titleOf('"Rail layout."')).toBe("Rail layout")
    expect(titleOf("**Tab titles**")).toBe("Tab titles")
    expect(titleOf("“Sync bug”")).toBe("Sync bug")
  })
  test("null for more than one line, too many words, or nothing", () => {
    expect(titleOf("Rail layout\nBecause the thread is about the rail")).toBe(
      null,
    )
    expect(titleOf("one two three four five six")).toBeNull()
    expect(titleOf("one two three four five")).toBe("one two three four five")
    expect(titleOf(' "" ')).toBeNull()
    expect(titleOf("x".repeat(81))).toBeNull()
  })
})

test("titleStillWanted: an asked one always; an unasked one only over no mark", () => {
  expect(titleStillWanted(mark, ADA)).toBe(true)
  expect(titleStillWanted(undefined, THE_AGENT)).toBe(true)
  expect(titleStillWanted(mark, THE_AGENT)).toBe(false)
})
