import { entryId, type TranscriptMessage } from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  describeRequest,
  firstAndNewest,
  fitNewest,
  leftOut,
  oneLine,
  transcriptLines,
  wordCount,
} from "./request.ts"

const message = (
  role: string,
  text: string,
  author?: string,
): TranscriptMessage => ({
  id: entryId(text),
  thread: FIXTURE_THREAD,
  role,
  text,
  ...(author === undefined ? {} : { author }),
})

describe("transcriptLines", () => {
  test("people and the agent, by speaker; nothing else", () => {
    expect(
      transcriptLines([
        message("person", "hello", "ana"),
        message("person", "anyone?"),
        message("user", "run it"),
        message("assistant", "done"),
        message("toolResult", "ok"),
      ]),
    ).toEqual([
      "ana: hello",
      "someone: anyone?",
      "someone: run it",
      "agent: done",
    ])
  })
})

describe("fitNewest", () => {
  test("keeps everything that fits", () => {
    expect(fitNewest(["a", "b"], 100)).toEqual({
      text: "- a\n- b\n",
      dropped: 0,
    })
  })

  test("keeps the newest, and counts the rest", () => {
    // "- b\n" and "- c\n" are 4 characters each.
    expect(fitNewest(["a", "b", "c"], 8)).toEqual({
      text: "- b\n- c\n",
      dropped: 1,
    })
  })

  test("stops at the first that does not fit, so an older short one is not kept", () => {
    expect(fitNewest(["a", "a very long line", "c"], 8)).toEqual({
      text: "- c\n",
      dropped: 2,
    })
  })

  test("no room keeps nothing", () => {
    expect(fitNewest(["a"], 0)).toEqual({ text: "", dropped: 1 })
  })
})

test("leftOut says how many, and nothing for none", () => {
  expect(leftOut(0)).toBe("")
  expect(leftOut(3)).toBe("- (3 earlier left out)\n")
})

describe("the commit message", () => {
  test("describeRequest: the thread's messages go first, then the diff; never the skill", () => {
    const skill = "Write a commit message."
    const full = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["first", "second"],
      recent: ["feat: a thing"],
      budget: 10_000,
    })
    expect(full.system).toBe(skill)
    expect(full.user).toContain("- first")
    expect(full.user).toContain("d".repeat(100))
    const tight = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["an early one", "x"],
      recent: [],
      budget: 190,
    })
    expect(tight.system).toBe(skill)
    expect(tight.user).not.toContain("an early one")
    expect(tight.user).toContain("d".repeat(100))
    const tighter = describeRequest({
      skill,
      diff: "d".repeat(500),
      messages: ["m"],
      recent: [],
      budget: 200,
    })
    expect(tighter.user).toContain("the rest of the diff left out")
  })
})

describe("oneLine", () => {
  test("oneLine refuses a second line, and never cuts", () => {
    expect(oneLine('  "Fixing the rail."  ', 3)).toBe("Fixing the rail")
    expect(oneLine("\nFixing the rail\n\n", 3)).toBe("Fixing the rail")
    expect(oneLine("Fixing the rail\nand more", 9)).toBeNull()
    expect(oneLine("one two three four", 3)).toBeNull()
    expect(oneLine("  ", 3)).toBeNull()
  })
  test("wordCount counts words, not the spaces around them", () => {
    expect(wordCount("  a  b c ")).toBe(3)
    expect(wordCount("")).toBe(0)
  })
})

test("firstAndNewest keeps the first line, and cuts the oldest of the rest first", () => {
  const rest = Array.from({ length: 20 }, (_, i) => `line ${i}`)
  const { first, newest } = firstAndNewest("the first", rest, 120)
  expect(first).toBe("- the first\n")
  expect(newest).toContain("earlier left out")
  expect(newest).toContain("- line 19\n")
  expect(newest).not.toContain("- line 0\n")
  expect(firstAndNewest("x", ["a"], 1_000).newest).toBe("- a\n")
})
