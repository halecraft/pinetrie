import { writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  alreadySentWords,
  cardStatus,
  commandTag,
  commandWords,
  queuedWords,
  unsentWords,
} from "./card-words.ts"

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }

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
      "alreadySentWords, yours",
      alreadySentWords(ME, READER),
      "already sent as your message: it was taken before you unqueued it",
    ],
    [
      "alreadySentWords, Bea's",
      alreadySentWords(BEA, READER),
      "already sent as Bea's message: it was taken before you unqueued it",
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
