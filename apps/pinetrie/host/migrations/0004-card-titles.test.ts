import { SESSION_TARGET } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planCardTitles } from "./0004-card-titles.ts"

test("a note column's title is written as its card's title, and deleted where it was", () => {
  const value = { title: "Ideas", by: "w-ada", at: 1 }
  expect(planCardTitles({ "n-1": value })).toEqual([
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: "pinetrie.card-title",
      key: "n-1",
      value,
    },
    {
      kind: "delete",
      target: SESSION_TARGET,
      namespace: "pinetrie.note-column",
      key: "n-1",
    },
  ])
  expect(planCardTitles({})).toEqual([])
})
