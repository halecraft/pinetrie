import type { ThreadName } from "@pinetrie/core"
import {
  commitId,
  laneNameForThread,
  type ReviewFile,
  type RevisionReview,
  withTrailers,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { ReviewTarget } from "./column-view.ts"
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
const span = (commit: typeof C1) => ({ kind: "revision", commit }) as const
const target: ReviewTarget = {
  lane: LANE,
  spans: [span(C1), span(C2)],
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
    expect(view.revisions.map(r => [r.key, r.state.kind])).toEqual([
      [C1, "loading"],
      [C2, "ready"],
    ])
  })
  test("the file list shows only when there is more than one file to list", () => {
    const alone = { ...target, spans: [span(C1)] }
    const listed = (t: typeof target, got: Loaded<RevisionReview>[]) =>
      reviewView(t, got).listed
    expect([
      listed(alone, [ready(two)]),
      listed(alone, [{ kind: "loading" }]),
      listed(alone, [ready({ description: "x", files: [] })]),
      listed(alone, [ready(one)]),
      listed(target, [ready(two), ready(two)]),
      listed(target, [{ kind: "loading" }, { kind: "loading" }]),
    ]).toEqual([false, false, false, true, true, true])
  })
  test("the head carries the one revision's title; a stack's list carries each", () => {
    const title = (t: typeof target, got: Loaded<RevisionReview>[]) =>
      reviewView(t, got).title
    expect([
      title({ ...target, spans: [span(C1)] }, [ready(two)]),
      title({ ...target, spans: [span(C1)] }, [{ kind: "loading" }]),
      title(target, [ready(one), ready(two)]),
    ]).toEqual(["feat: two", undefined, undefined])
  })
  test("an ask's range, with no description, is headed by the ask (ADR-0056)", () => {
    const ask: ReviewTarget = {
      ...target,
      spans: [{ kind: "range", from: C1, to: C2 }],
      title: 'Ada: "Fix it"',
    }
    expect(
      reviewView(ask, [
        ready({ description: "", files: [file("a.txt", 1, 0)] }),
      ]).title,
    ).toBe('Ada: "Fix it"')
  })
  test("a file over 400 changed lines starts collapsed; one at 400 does not", () => {
    const rows = (added: number) => {
      const v = reviewView({ ...target, spans: [span(C1)] }, [
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
