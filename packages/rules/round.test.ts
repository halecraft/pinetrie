import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { NOTHING_NEXT, roundReplyOf, roundRequest } from "./round.ts"

const fox = threadIdFor("fox")
const members = new Map([["amber-fox", fox]])

describe("after a round of answers", () => {
  test("a reply is nothing, an ask of a member, or a line for the people", () => {
    expect(roundReplyOf("nothing", members)).toEqual(NOTHING_NEXT)
    expect(roundReplyOf("ask amber-fox: answer slate-owl", members)).toEqual({
      kind: "ask",
      thread: fox,
      text: "answer slate-owl",
    })
    expect(roundReplyOf("people: they disagree on X", members)).toEqual({
      kind: "people",
      line: "they disagree on X",
    })
  })
  test("anything else is nothing: prose, a stranger, two lines", () => {
    expect(roundReplyOf("I think amber-fox should go on", members)).toEqual(
      NOTHING_NEXT,
    )
    expect(roundReplyOf("ask slate-owl: go", members)).toEqual(NOTHING_NEXT)
    expect(roundReplyOf("ask amber-fox: go\nnothing", members)).toEqual(
      NOTHING_NEXT,
    )
  })
  test("the request names the members and keeps the newest lines", () => {
    const request = roundRequest({
      skill: " the skill ",
      members: ["amber-fox", "slate-owl"],
      lines: ["agent: one", "amber-fox: two"],
    })
    expect(request.system).toBe("the skill")
    expect(request.user).toContain("amber-fox, slate-owl")
    expect(request.user).toContain("- amber-fox: two")
  })
})
