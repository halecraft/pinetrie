import { describe, expect, test } from "vitest"
import {
  type JjFileStat,
  jjReviewContent,
  planJjReviewContent,
} from "./review-content.ts"

const stat = (
  path: string,
  change: JjFileStat["change"],
  size: JjFileStat["size"],
  lines = 0,
): JjFileStat => ({ path, change, added: lines, removed: 0, size })
const delta = (bytes: number) => ({ kind: "delta", bytes }) as const
const COUNT = { kind: "count" } as const

describe("planJjReviewContent", () => {
  test("reads only files with no lines and no move", () => {
    expect(
      planJjReviewContent([
        stat("a.txt", "modified", delta(3), 2),
        stat("moved.bin", "renamed", delta(0)),
        stat("a.png", "added", delta(10)),
      ]),
    ).toEqual([{ path: "a.png", side: "after", whole: false }])
  })

  test("with a delta, a modified file is read whole on one side only", () => {
    expect(planJjReviewContent([stat("a.bin", "modified", delta(4))])).toEqual([
      { path: "a.bin", side: "before", whole: true },
      { path: "a.bin", side: "after", whole: false },
    ])
    expect(planJjReviewContent([stat("a.bin", "removed", delta(-4))])).toEqual([
      { path: "a.bin", side: "before", whole: false },
    ])
  })

  test("with a count, each side it needs is read whole", () => {
    expect(planJjReviewContent([stat("a.bin", "modified", COUNT)])).toEqual([
      { path: "a.bin", side: "before", whole: true },
      { path: "a.bin", side: "after", whole: true },
    ])
  })
})

describe("jjReviewContent", () => {
  test("a modified image's sizes: its before counted, its after the delta past it", () => {
    expect(
      jjReviewContent(stat("a.png", "modified", delta(5)), side =>
        side === "before"
          ? { content: "image/png", size: 10 }
          : { content: "image/png", size: null },
      ),
    ).toEqual({
      kind: "media",
      before: { content: "image/png", size: 10 },
      after: { content: "image/png", size: 15 },
    })
  })

  test("a removed binary's size is minus its delta; a text with no lines is lines", () => {
    expect(
      jjReviewContent(stat("a.bin", "removed", delta(-7)), () => ({
        content: "binary",
        size: null,
      })),
    ).toEqual({
      kind: "media",
      before: { content: "binary", size: 7 },
      after: null,
    })
    expect(
      jjReviewContent(stat("a.txt", "modified", delta(0)), () => ({
        content: "text",
        size: 3,
      })),
    ).toEqual({ kind: "lines" })
  })
})
