import {
  type AgentMessageLike,
  atEntry,
  canvasIdFor,
  type EntryLike,
  entryId,
  indexTree,
  type LaneRecord,
  ROOT,
  rootIdFor,
  THE_AGENT,
  type TreeIndex,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { FIXTURE_THREAD, personMessage } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  planTitling,
  replyTitle,
  titleRequest,
  titleStillWanted,
} from "./index.ts"
import type { MarkRecord } from "./mark.ts"

const ADA = writerId("ada@example.com")
const R = rootIdFor("1")
const OTHER = rootIdFor("2")
const L1 = threadIdFor("1")
const L2 = threadIdFor("2")

const at = (
  id: string,
  parentId: string | null,
  message: AgentMessageLike,
): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  thread: FIXTURE_THREAD,
  type: "message",
  message,
})
const indexOf = (...entries: EntryLike[]): TreeIndex =>
  indexTree(Object.fromEntries(entries.map(e => [e.id, e])))

// A root that began as a chat, then a branch off its first message.
const said = indexOf(
  at(
    "c0000000-0000-7000-8000-000000000000",
    null,
    personMessage("the rail", { author: "Ada" }),
  ),
  at(
    "c0000000-0000-7000-8000-000000000001",
    "c0000000-0000-7000-8000-000000000000",
    personMessage("too tall", { author: "Bea" }),
  ),
  at(
    "c0000000-0000-7000-8000-000000000002",
    "c0000000-0000-7000-8000-000000000000",
    personMessage("newest", { author: "Bea" }),
  ),
)
const lane = (l: typeof L1, root = R): LaneRecord => ({
  lane: l,
  root,
  history: null,
  by: ADA,
  createdAt: 0,
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
      marked: false,
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
        index: said,
        trigger: {
          ...started,
          at: atEntry(entryId("c0000000-0000-7000-8000-000000000001")),
        },
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
    expect(plan({ index: said, marked: true })).toEqual({ kind: "skip" })
  })

  test("asked: the path to the newest message, whatever is stored, as the person", () => {
    expect(
      plan({
        index: said,
        marked: true,
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

describe("replyTitle", () => {
  test("bare words, without quotes or trailing punctuation", () => {
    expect(replyTitle(" Rail layout ")).toBe("Rail layout")
    expect(replyTitle('"Rail layout."')).toBe("Rail layout")
    expect(replyTitle("**Tab titles**")).toBe("Tab titles")
    expect(replyTitle("“Sync bug”")).toBe("Sync bug")
  })
  test("null for more than one line, too many words, or nothing", () => {
    expect(
      replyTitle("Rail layout\nBecause the thread is about the rail"),
    ).toBe(null)
    expect(replyTitle("one two three four five six")).toBeNull()
    expect(replyTitle("one two three four five")).toBe(
      "one two three four five",
    )
    expect(replyTitle(' "" ')).toBeNull()
    expect(replyTitle("x".repeat(81))).toBeNull()
  })
})

test("titleStillWanted: an asked one always; an unasked one only over no mark", () => {
  const mark: MarkRecord = {
    canvas: canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
    title: "Rail",
    by: ADA,
    at: 1,
  }
  expect(titleStillWanted(mark, ADA)).toBe(true)
  expect(titleStillWanted(undefined, THE_AGENT)).toBe(true)
  expect(titleStillWanted(mark, THE_AGENT)).toBe(false)
})
