import { expect, test } from "vitest"
import { cardCommandGetLatest } from "./0015-card-command-get-latest.ts"

test("a card's command in the old words is renamed, its other fields kept", () => {
  expect(
    cardCommandGetLatest({ kind: "queued", command: "bring-up-to-date" }),
  ).toEqual({ kind: "queued", command: "get-latest" })
  expect(cardCommandGetLatest({ command: "catch-up-with-parent" })).toEqual({
    command: "get-latest-from-parent",
  })
})

test("a card with no command, a split, or one already renamed needs nothing", () => {
  for (const command of ["", "split", "get-latest", "continue-on-accepted"])
    expect(cardCommandGetLatest({ command })).toBeNull()
})
