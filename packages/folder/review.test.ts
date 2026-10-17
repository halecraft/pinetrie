import type { DiffStat, PathFact } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  pairRenames,
  planFolderReview,
  renameCandidates,
  renameShown,
} from "./review.ts"

const text = (size = 3): PathFact => ({
  kind: "file",
  exec: false,
  content: "text",
  size,
})
const png = (size: number): PathFact => ({
  kind: "file",
  exec: false,
  content: "image/png",
  size,
})
const binary = (size: number): PathFact => ({
  kind: "file",
  exec: false,
  content: "binary",
  size,
})
const ABSENT: PathFact = { kind: "absent" }
const stat = (path: string, added = 0, removed = 0): DiffStat => ({
  path,
  added,
  removed,
})
const review = (
  rows: readonly [string, PathFact, PathFact, number?, number?][],
  renames: Parameters<typeof planFolderReview>[0]["renames"] = [],
) =>
  planFolderReview({
    files: rows.map(r => r[0]),
    stats: rows.map(([p, , , a, r]) => stat(p, a, r)),
    before: rows.map(r => r[1]),
    after: rows.map(r => r[2]),
    renames,
    description: "",
  }).files

describe("planFolderReview", () => {
  test("text on both sides, or text added, is lines", () => {
    expect(
      review([
        ["a.txt", text(), text(), 2, 1],
        ["b.txt", ABSENT, text(), 4, 0],
      ]),
    ).toEqual([
      {
        path: "a.txt",
        shown: "a.txt",
        change: "modified",
        added: 2,
        removed: 1,
        content: { kind: "lines" },
      },
      {
        path: "b.txt",
        shown: "b.txt",
        change: "added",
        added: 4,
        removed: 0,
        content: { kind: "lines" },
      },
    ])
  })

  test("an image on each side is media with both sides' sizes; an image added has no before", () => {
    const [changed, added] = review([
      ["a.png", png(10), png(12)],
      ["b.png", ABSENT, png(7)],
    ])
    expect(changed?.content).toEqual({
      kind: "media",
      before: { content: "image/png", size: 10 },
      after: { content: "image/png", size: 12 },
    })
    expect([added?.change, added?.content]).toEqual([
      "added",
      {
        kind: "media",
        before: null,
        after: { content: "image/png", size: 7 },
      },
    ])
  })

  test("a binary, and a text replaced by a binary, are media", () => {
    const [bin, replaced] = review([
      ["a.bin", binary(5), binary(6)],
      ["b.txt", text(3), binary(4)],
    ])
    expect(bin?.content.kind).toBe("media")
    expect(replaced?.content).toEqual({
      kind: "media",
      before: { content: "text", size: 3 },
      after: { content: "binary", size: 4 },
    })
  })

  test("a move is one row, renamed, with no lines", () => {
    expect(
      review(
        [
          ["docs/old.md", text(9), ABSENT, 0, 1],
          ["docs/new.md", ABSENT, text(9), 1, 0],
        ],
        [{ a: "docs/old.md", b: "docs/new.md" }],
      ),
    ).toEqual([
      {
        path: "docs/new.md",
        shown: "docs/{old.md => new.md}",
        change: "renamed",
        added: 0,
        removed: 0,
        content: { kind: "lines" },
      },
    ])
  })
})

describe("renames", () => {
  test("renameCandidates pairs a path gone with each path added of its size", () => {
    expect(
      renameCandidates(
        [{ path: "a", size: 3 }],
        [
          { path: "b", size: 3 },
          { path: "c", size: 4 },
        ],
      ),
    ).toEqual([{ a: "a", b: "b" }])
  })

  test("pairRenames: one equal pair is a move", () => {
    const pair = { a: "old", b: "new" }
    expect(pairRenames([pair], [pair])).toEqual([pair])
  })

  test("pairRenames: two copies of one file pair with nothing", () => {
    const candidates = [
      { a: "old", b: "one" },
      { a: "old", b: "two" },
    ]
    expect(pairRenames(candidates, candidates)).toEqual([])
  })

  test("pairRenames: a moved and edited file, its bytes not equal, pairs with nothing", () => {
    expect(pairRenames([{ a: "old", b: "new" }], [])).toEqual([])
  })

  test("renameShown: under their common directory, as jj writes a move", () => {
    expect(renameShown("a.txt", "b.txt")).toBe("{a.txt => b.txt}")
    expect(renameShown("src/a/x.ts", "src/b/x.ts")).toBe(
      "src/{a/x.ts => b/x.ts}",
    )
  })
})
