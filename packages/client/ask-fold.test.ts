import { describe, expect, test } from "vitest"
import { type FoldFacts, foldMemory, foldOpen, toggled } from "./ask-fold.ts"

const facts = (over: Partial<FoldFacts>): FoldFacts => ({
  choice: null,
  density: "story",
  running: false,
  endedWhileAway: false,
  ...over,
})

describe("foldOpen", () => {
  test.each<[string, Partial<FoldFacts>, boolean]>([
    ["story: a running ask is open", { running: true }, true],
    ["story: an ended ask is folded", {}, false],
    [
      "story: a reader scrolled away before the run ended keeps it open",
      { endedWhileAway: true },
      true,
    ],
    [
      "outline: nothing opens by itself",
      { density: "outline", running: true },
      false,
    ],
    ["raw: everything is open", { density: "raw" }, true],
    ["the reader's choice wins, open", { choice: "open" }, true],
    [
      "the reader's choice wins, closed, even running",
      { choice: "closed", running: true },
      false,
    ],
    [
      "outline: the reader can open one",
      { density: "outline", choice: "open" },
      true,
    ],
  ])("%s", (_, over, open) => {
    expect(foldOpen(facts(over))).toBe(open)
  })
  test("a press chooses the other of what it shows", () => {
    expect([toggled(true), toggled(false)]).toEqual(["closed", "open"])
  })
})

test("foldMemory: a choice is kept, and heard only when it changes", () => {
  const m = foldMemory()
  let heard = 0
  const off = m.subscribe(() => {
    heard += 1
  })
  m.set("a", "open")
  m.set("a", "open")
  expect([m.get("a"), m.get("b"), heard]).toEqual(["open", undefined, 1])
  off()
  m.set("a", "closed")
  expect([m.get("a"), heard]).toEqual(["closed", 1])
})
