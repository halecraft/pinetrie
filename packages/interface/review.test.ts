import type { ThreadName } from "@pinetrie/core"
import {
  commitId,
  pointFromCommit,
  type ReviewFile,
  type RevisionReview,
  threadIdFor,
  withTrailers,
} from "@pinetrie/core"
import { fileUrl } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { ReviewTarget } from "./column-view.ts"
import {
  diffLines,
  type Loaded,
  type ReviewPref,
  reviewPrefWords,
  reviewView,
  sectionState,
} from "./review.ts"

const LANE = threadIdFor("1")
const C1 = commitId("c1")
const C2 = commitId("c2")
const file = (path: string, added: number, removed: number): ReviewFile => ({
  path,
  shown: path,
  change: "modified",
  added,
  removed,
  content: { kind: "lines" },
})
const ready = <T>(value: T): Loaded<T> => ({ kind: "ready", value })
const span = (commit: typeof C1) => ({ kind: "revision", commit }) as const
const target: ReviewTarget = {
  spans: [span(C1), span(C2)],
  conflicts: ["b.txt"],
  workingCopyEdits: ["a.txt"],
}

describe("reviewView", () => {
  test("a revision whose pinetrie.json widens what lanes may do says what, in one line", () => {
    const widened = reviewView({ ...target, spans: [span(C1)] }, [
      ready({
        description: "feat: grant\n",
        files: [file("pinetrie.json", 1, 0)],
        widenings: [{ kind: "ssh" }, { kind: "env", name: "TOKEN" }],
      }),
    ]).revisions[0]?.state
    expect(widened?.kind === "ready" ? widened.value.widens : null).toBe(
      "Accepting this lets threads use your ssh identity, $TOKEN.",
    )
  })
  const at = { lane: LANE, name: "amber-fox" as ThreadName, entry: "e1" }
  const one: RevisionReview = {
    description: withTrailers("feat: one\n\nwhy it changed", at),
    files: [file("a.txt", 3, 1), file("b.txt", 0, 0)],
    widenings: [],
  }
  const two: RevisionReview = {
    description: "feat: two\n",
    files: [{ ...file("a.txt", 401, 0), change: "added" }],
    widenings: [],
  }
  test("flags conflicts and your edits by path, and counts lines", () => {
    const view = reviewView(target, [ready(one), ready(two)])
    const [first, second] = view.revisions.map(r =>
      r.state.kind === "ready" ? r.state.value : null,
    )
    expect(first).toMatchObject({ title: "feat: one", body: "why it changed" })
    expect(
      first?.files.map(f => [f.letter, f.lines, f.conflicts, f.editing]),
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
  test("a media row has its sides' URLs and sizes and no lines; a renamed row with no lines is moved, unchanged, media or not", () => {
    const view = reviewView({ ...target, spans: [span(C1)] }, [
      ready({
        description: "feat: media\n",
        files: [
          {
            ...file("a.png", 0, 0),
            content: {
              kind: "media",
              before: { content: "image/png", size: 1200 },
              after: { content: "image/png", size: 1_500_000 },
            },
          },
          {
            ...file("b.bin", 0, 0),
            change: "added",
            content: {
              kind: "media",
              before: null,
              after: { content: "binary", size: 12 },
            },
          },
          {
            ...file("new.txt", 0, 0),
            shown: "{old.txt => new.txt}",
            change: "renamed",
          },
          {
            ...file("new.png", 0, 0),
            shown: "{old.png => new.png}",
            change: "renamed",
            content: {
              kind: "media",
              before: { content: "image/png", size: 10 },
              after: { content: "image/png", size: 10 },
            },
          },
        ],
        widenings: [],
      }),
    ])
    const rows =
      view.revisions[0]?.state.kind === "ready"
        ? view.revisions[0].state.value.files
        : []
    expect(rows.map(r => [r.path, r.media?.kind ?? null, r.moved])).toEqual([
      ["a.png", "image", false],
      ["b.bin", "file", false],
      ["new.txt", null, true],
      // A moved image is a move, never a side drawn as added.
      ["new.png", null, true],
    ])
    expect(rows[0]?.media).toEqual({
      kind: "image",
      before: { url: fileUrl(span(C1), "a.png", "before"), size: "1.2 KB" },
      after: { url: fileUrl(span(C1), "a.png", "after"), size: "1.5 MB" },
    })
    expect(rows[1]?.media?.before).toBeNull()
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
      listed(alone, [ready({ description: "x", files: [], widenings: [] })]),
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
  test("an ask's range, with no description, is headed by the ask", () => {
    const ask: ReviewTarget = {
      ...target,
      spans: [
        { kind: "range", from: pointFromCommit(C1), to: pointFromCommit(C2) },
      ],
      title: 'Ada: "Fix it"',
    }
    expect(
      reviewView(ask, [
        ready({ description: "", files: [file("a.txt", 1, 0)], widenings: [] }),
      ]).title,
    ).toBe('Ada: "Fix it"')
  })
  test("a file over 400 changed lines starts collapsed; one at 400 does not", () => {
    const rows = (added: number) => {
      const v = reviewView({ ...target, spans: [span(C1)] }, [
        ready({
          description: "x",
          files: [file("a.txt", added, 0)],
          widenings: [],
        }),
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

describe("reviewPrefWords", () => {
  test.each<[ReviewPref, boolean, string, string]>([
    ["wrap", false, "↩", "wrap long lines"],
    ["wrap", true, "↩", "stop wrapping long lines"],
    ["listFolded", false, "☰", "hide the file list"],
    ["listFolded", true, "☰", "show the file list"],
  ])("%s, on %s", (pref, on, glyph, label) => {
    expect(reviewPrefWords(pref, on)).toEqual({ glyph, label })
  })
})
