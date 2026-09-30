import type { TranscriptMessage } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { fitNewest, leftOut, transcriptLines } from "./request.ts"

const message = (
  role: string,
  text: string,
  author?: string,
): TranscriptMessage => ({
  id: text,
  role,
  text,
  ...(author === undefined ? {} : { author }),
})

describe("transcriptLines", () => {
  test("people and the agent, by speaker; nothing else", () => {
    expect(
      transcriptLines([
        message("chat", "hello", "ana"),
        message("chat", "anyone?"),
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
