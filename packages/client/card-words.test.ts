import { cardId, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { Refusal } from "./card-moves.ts"
import {
  cardStatus,
  commandTag,
  commandWords,
  queuedWords,
  refusalWords,
  unsentWords,
} from "./card-words.ts"

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
const refusal = (over: Partial<Refusal>): Refusal => ({
  card: cardId("c-1"),
  lane: null,
  code: "gone",
  by: null,
  fromQueue: true,
  ...over,
})

describe("card words", () => {
  test.each([
    ["commandWords", commandWords("bring-up-to-date"), "bring up to date"],
    ["commandTag", commandTag("bring-up-to-date"), "→ bring up to date"],
    [
      "queuedWords, yours",
      queuedWords(ME, 0, READER),
      "queued by you · 1st in line",
    ],
    [
      "queuedWords, Bea's",
      queuedWords(BEA, 1, READER),
      "queued by Bea · 2nd in line",
    ],
    ["unsentWords", unsentWords("no such image"), "not sent: no such image"],
    [
      "refusalWords, an unqueue the take beat, yours",
      refusalWords(refusal({ by: ME }), READER),
      "already sent as your message: it was taken before you unqueued it",
    ],
    [
      "refusalWords, an unqueue the take beat, Bea's",
      refusalWords(refusal({ by: BEA }), READER),
      "already sent as Bea's message: it was taken before you unqueued it",
    ],
    [
      "refusalWords, gone from a drafting place",
      refusalWords(refusal({ fromQueue: false }), READER),
      "not moved: it was sent or removed first",
    ],
    [
      "refusalWords, moved by Bea first",
      refusalWords(refusal({ code: "moved", by: BEA }), READER),
      "not moved: Bea moved it first",
    ],
    [
      "refusalWords, moved by you in another tab",
      refusalWords(refusal({ code: "moved", by: ME }), READER),
      "not moved: you moved it first",
    ],
  ])("%s", (_, words, expected) => {
    expect(words).toBe(expected)
  })
})

test("cardStatus: the send's own status first; else why the host could not send the card", () => {
  expect(cardStatus("sending…", "no such image")).toBe("sending…")
  expect(cardStatus("", "no such image")).toBe("not sent: no such image")
  expect(cardStatus("", null)).toBe("")
})
