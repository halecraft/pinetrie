import type { ThreadName } from "@pineta/core"
import {
  commitId,
  laneNameForThread,
  type ReviewFile,
  type RevisionReview,
} from "@pineta/core"
import { withTrailers } from "@pineta/marginalia"
import { describe, expect, test } from "vitest"
import { diffLines, type Loaded, reviewView, sectionState } from "./review.ts"

const LANE = laneNameForThread("1")
const C1 = commitId("c1")
const C2 = commitId("c2")
const file = (path: string, added: number, removed: number): ReviewFile => ({
  path,
  shown: path,
  change: "modified",
  added,
  removed,
})
const ready = <T>(value: T): Loaded<T> => ({ kind: "ready", value })
const target = {
  lane: LANE,
  commits: [C1, C2],
  conflicts: ["b.txt"],
  yourEdits: ["a.txt"],
}

describe("reviewView", () => {
  const at = { lane: LANE, name: "amber-fox" as ThreadName, entry: "e1" }
  const one: RevisionReview = {
    description: withTrailers("feat: one\n\nwhy it changed", at),
    files: [file("a.txt", 3, 1), file("b.txt", 0, 0)],
  }
  const two: RevisionReview = {
    description: "feat: two\n",
    files: [{ ...file("a.txt", 401, 0), change: "added" }],
  }
  test("flags conflicts and your edits by path, and counts lines", () => {
    const view = reviewView(target, [ready(one), ready(two)])
    const [first, second] = view.revisions.map(r =>
      r.state.kind === "ready" ? r.state.value : null,
    )
    expect(first).toMatchObject({ title: "feat: one", body: "why it changed" })
    expect(
      first?.files.map(f => [f.letter, f.lines, f.conflicts, f.yours]),
    ).toEqual([
      ["M", "+3 −1", false, true],
      ["M", "", true, false],
    ])
    expect(second).toMatchObject({ title: "feat: two", body: "" })
    // One path in two revisions: two rows, two keys.
    const keys = [...(first?.files ?? []), ...(second?.files ?? [])].map(
      f => f.key,
    )
    expect(new Set(keys).size).toBe(3)
    expect(second?.files[0]?.letter).toBe("A")
  })
  test("a revision still loading keeps its place", () => {
    const view = reviewView(target, [{ kind: "loading" }, ready(two)])
    expect(view.revisions.map(r => [r.commit, r.state.kind])).toEqual([
      [C1, "loading"],
      [C2, "ready"],
    ])
  })
  test("a file over 400 changed lines starts collapsed; one at 400 does not", () => {
    const rows = (added: number) => {
      const v = reviewView({ ...target, commits: [C1] }, [
        ready({ description: "x", files: [file("a.txt", added, 0)] }),
      ]).revisions[0]?.state
      return v?.kind === "ready" ? v.value.files[0]?.startsCollapsed : null
    }
    expect([rows(400), rows(401)]).toEqual([false, true])
  })
})

describe("sectionState", () => {
  test("a big file waits to be opened; others wait to be near, then follow their fetch", () => {
    expect(sectionState(true, false, true, null)).toBe("collapsed")
    expect(sectionState(true, true, true, null)).toBe("loading")
    expect(sectionState(false, true, true, null)).toBe("collapsed")
    expect(sectionState(false, false, false, null)).toBe("waiting")
    expect(sectionState(false, false, true, { kind: "loading" })).toBe(
      "loading",
    )
    expect(sectionState(false, false, true, ready("+a"))).toBe("shown")
    const failed = (status: number) =>
      sectionState(false, false, true, {
        kind: "failed",
        status,
        reason: "",
      })
    expect([failed(413), failed(502)]).toEqual(["too-large", "failed"])
  })
})

test("diffLines: headers, hunks, added, removed, context, and no newline", () => {
  const text = [
    "diff --git a/x b/x",
    "index 1..2 100644",
    "--- a/x",
    "+++ b/x",
    "@@ -1,2 +1,2 @@",
    " same",
    "-old",
    "+new",
    "\\ No newline at end of file",
    "",
  ].join("\n")
  expect(diffLines(text).map(l => l.kind)).toEqual([
    "meta",
    "meta",
    "meta",
    "meta",
    "hunk",
    "same",
    "del",
    "add",
    "meta",
  ])
  // A rename's diff is its header alone.
  expect(
    diffLines("diff --git a/w b/w2\nrename from w\nrename to w2\n").map(
      l => l.kind,
    ),
  ).toEqual(["meta", "meta", "meta"])
  expect(diffLines("")).toEqual([])
})
