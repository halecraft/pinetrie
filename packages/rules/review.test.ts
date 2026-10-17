import {
  commitId,
  type EntryId,
  entryId,
  type FolderProposedChangesRecord,
  type JjProposedChangesRecord,
  pointId,
  type RevisionRecord,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  answerDiff,
  answerReview,
  diffUrl,
  fileUrl,
  parseReviewPath,
  planReviewRead,
  type ReviewFacts,
  readableSpan,
  reviewUrl,
} from "./index.ts"
import { MAX_DIFF_BYTES, REVIEW_WIRE } from "./review.ts"

const LANE = threadIdFor("1")
const _ADA = writerId("ada@x.io")
const _TIP = commitId("t1")
const _T2 = commitId("t2")
const _BASE = commitId("b0")
const _COPY = commitId("k1")

const proposed: JjProposedChangesRecord = {
  kind: "jj",
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pinetrie-proposed/t-1",
  acceptedAs: null,
  commits: [commitId("w1")],
  ledger: null,
  at: 10,
}

describe("the review", () => {
  const C1 = commitId("c1")
  const C2 = commitId("c2")
  const open: JjProposedChangesRecord = { ...proposed, commits: [C1, C2] }
  const proposedByLane = new Map([[LANE, open]])
  const facts = (
    o: ReadonlyMap<ThreadId, JjProposedChangesRecord>,
    revisions: ReadonlyMap<EntryId, RevisionRecord> = new Map(),
  ) => ({ proposedByLane: o, revisions, accepted: null, conflicts: [] })
  const rev = (c: string) => ({ kind: "revision", commit: c }) as const
  test("planReviewRead: only a commit open proposed changes hold now", () => {
    expect(
      planReviewRead(facts(proposedByLane), { kind: "review", span: rev(C2) }),
    ).toEqual({
      kind: "review",
      span: rev(C2),
    })
    expect(
      planReviewRead(facts(proposedByLane), {
        kind: "diff",
        span: rev(C1),
        path: "a b.txt",
      }),
    ).toEqual({ kind: "diff", span: rev(C1), path: "a b.txt" })
    const status = (
      o: ReadonlyMap<ThreadId, JjProposedChangesRecord>,
      commit: string,
    ) => {
      const read = planReviewRead(facts(o), {
        kind: "review",
        span: rev(commit),
      })
      return read.kind === "refused" ? read.status : read.kind
    }
    // A commit the proposed changes no longer are, and one it never was.
    expect(status(proposedByLane, "w1")).toBe(404)
    expect(status(proposedByLane, "ffff")).toBe(404)
    const accepted = new Map([[LANE, { ...open, acceptedAs: "t" }]])
    expect(status(accepted, C1)).toBe(404)
    // One accepted work already holds brings nothing to review.
    const held = new Map([[LANE, { ...open, files: [] }]])
    expect(status(held, C1)).toBe(404)
    const path = (p: string) => {
      const read = planReviewRead(facts(proposedByLane), {
        kind: "diff",
        span: rev(C1),
        path: p,
      })
      return read.kind === "refused" ? read.status : read.kind
    }
    expect([path(""), path("a\nb"), path("a\u007f")]).toEqual([400, 400, 400])
  })
  test("planReviewRead: an open folder proposed changes' range, with its lane", () => {
    const folder: FolderProposedChangesRecord = {
      kind: "folder",
      lane: LANE,
      start: pointId("line-0192aaaa"),
      tip: pointId("turn-0192bbbb"),
      files: ["a.txt"],
      conflicts: [],
      description: null,
      at: 10,
    }
    const read = (o: FolderProposedChangesRecord, from: string, to: string) =>
      planReviewRead(
        {
          proposedByLane: new Map([[LANE, o]]),
          revisions: new Map(),
          accepted: null,
          conflicts: [],
        },
        { kind: "review", span: { kind: "range", from, to } },
      ).kind
    expect(
      planReviewRead(
        {
          proposedByLane: new Map([[LANE, folder]]),
          revisions: new Map(),
          accepted: null,
          conflicts: [],
        },
        {
          kind: "review",
          span: { kind: "range", from: folder.start, to: folder.tip },
        },
      ),
    ).toEqual({
      kind: "review",
      span: {
        kind: "range",
        from: folder.start,
        to: folder.tip,
        reader: { kind: "lane", lane: LANE },
      },
    })
    expect(read(folder, folder.tip, folder.start)).toBe("refused")
    expect(read({ ...folder, files: [] }, folder.start, folder.tip)).toBe(
      "refused",
    )
  })
  test("planReviewRead: a range only between two commits one lane's turns recorded", () => {
    const OTHER = threadIdFor("other")
    const record = (entry: string, lane: typeof LANE, commit: string) =>
      [
        entryId(entry),
        {
          entry: entryId(entry),
          lane,
          point: pointId(commit),
          snapshot: null,
          paths: [],
          conflicts: [],
          disk: null,
        },
      ] as const
    const revisions = new Map([
      record("e1", LANE, "a1"),
      record("e2", LANE, "a2"),
      record("e3", OTHER, "b1"),
    ])
    const range = (from: string, to: string) =>
      ({ kind: "range", from, to }) as const
    const read = (from: string, to: string) =>
      planReviewRead(facts(new Map(), revisions), {
        kind: "review",
        span: range(from, to),
      })
    expect(read("a1", "a2")).toEqual({
      kind: "review",
      span: { ...range("a1", "a2"), reader: { kind: "lane", lane: LANE } },
    })
    expect(read("a1", "b1")).toMatchObject({ kind: "refused", status: 404 })
    expect(read("a1", "ffff")).toMatchObject({ kind: "refused", status: 404 })
  })
  describe("a folder project's history and conflicts", () => {
    const L0 = pointId("line-0192aaaa")
    const L1 = pointId("line-0192bbbb")
    const L2 = pointId("line-0192cccc")
    const kept: ReviewFacts = {
      proposedByLane: new Map(),
      revisions: new Map(),
      accepted: { kind: "folder", newest: L2, kept: [L2, L1], at: 1 },
      conflicts: [
        {
          lane: LANE,
          path: "a.txt",
          base: L0,
          ours: pointId("turn-0192dddd"),
          theirs: L2,
        },
      ],
    }
    const range = (from: string, to: string) =>
      ({ kind: "range", from, to }) as const
    test("planReviewRead: two states accepted work keeps, read as accepted work's", () => {
      expect(
        planReviewRead(kept, { kind: "review", span: range(L1, L2) }),
      ).toEqual({
        kind: "review",
        span: { ...range(L1, L2), reader: { kind: "accepted" } },
      })
    })
    test("planReviewRead: a state accepted work no longer keeps is refused", () => {
      expect(
        planReviewRead(kept, { kind: "review", span: range(L0, L1) }),
      ).toMatchObject({ kind: "refused", status: 404 })
    })
    test("planReviewRead: a conflict's base and theirs, read as its lane", () => {
      expect(
        planReviewRead(kept, { kind: "review", span: range(L0, L2) }),
      ).toEqual({
        kind: "review",
        span: { ...range(L0, L2), reader: { kind: "lane", lane: LANE } },
      })
    })
    test("planReviewRead: a file's bytes at a side, its path checked as a diff's", () => {
      expect(
        planReviewRead(kept, {
          kind: "file",
          span: range(L1, L2),
          path: "img/a.png",
          side: "before",
        }),
      ).toEqual({
        kind: "file",
        span: { ...range(L1, L2), reader: { kind: "accepted" } },
        path: "img/a.png",
        side: "before",
      })
      expect(
        planReviewRead(kept, {
          kind: "file",
          span: range(L1, L2),
          path: "a\nb",
          side: "after",
        }),
      ).toMatchObject({ kind: "refused", status: 400 })
    })
    test("readableSpan: the oldest kept state's span from its swept parent is none", () => {
      expect(readableSpan(kept, L0, L1)).toBeNull()
      expect(readableSpan(kept, L1, L2)).not.toBeNull()
    })
  })
  test("answers: a review decoded, a diff within its size, else refused", () => {
    const review = {
      description: "feat: x\n",
      files: [
        {
          path: "w2",
          shown: "{w => w2}",
          change: "renamed",
          added: 0,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "a.png",
          shown: "a.png",
          change: "modified",
          added: 0,
          removed: 0,
          content: {
            kind: "media",
            before: { content: "image/png", size: 10 },
            after: { content: "binary", size: 12 },
          },
        },
      ],
      widenings: [{ kind: "env", name: "TOKEN" }],
    }
    expect(answerReview(structuredClone(review))).toEqual({
      kind: "review",
      review,
    })
    const status = (a: ReturnType<typeof answerReview>) =>
      a.kind === "refused" ? a.status : a.kind
    expect(status(answerReview(null))).toBe(502)
    expect(
      status(
        answerReview({
          ...review,
          files: [{ ...review.files[0], added: "1" }],
        }),
      ),
    ).toBe(502)
    expect(status(answerDiff(null))).toBe(502)
    expect(status(answerDiff("x".repeat(MAX_DIFF_BYTES)))).toBe("diff")
    expect(status(answerDiff("x".repeat(MAX_DIFF_BYTES + 1)))).toBe(413)
    // Bytes of UTF-8, not characters.
    expect(status(answerDiff("é".repeat(MAX_DIFF_BYTES / 2 + 1)))).toBe(413)
  })
  test("the wire: every URL parses back to what built it", () => {
    const at = (u: string) => parseReviewPath(new URL(u, "http://host"))
    const c = { kind: "revision", commit: commitId("0123abcd") } as const
    const r = {
      kind: "range",
      from: pointId("0123abcd"),
      to: pointId("4567ef"),
    } as const
    const folder = {
      kind: "range",
      from: pointId("line-0192aaaa"),
      to: pointId("turn-0192bbbb"),
    } as const
    for (const span of [c, r, folder]) {
      expect(at(reviewUrl(span))).toEqual({ kind: "review", span })
      for (const path of ["a b.txt", 'we"ird', "q?x&y#z", "dir/é.md"])
        expect(at(diffUrl(span, path))).toEqual({ kind: "diff", span, path })
      for (const side of ["before", "after"] as const)
        expect(at(fileUrl(span, "img/a b.png", side))).toEqual({
          kind: "file",
          span,
          path: "img/a b.png",
          side,
        })
    }
    expect(at(`/review/${REVIEW_WIRE}/file/${c.commit}?path=a`)).toBe("bad")
    expect(
      at(`/review/${REVIEW_WIRE}/file/${c.commit}?path=a&side=middle`),
    ).toBe("bad")
    expect(
      at(reviewUrl(c).replace(`/${REVIEW_WIRE}/`, `/${REVIEW_WIRE + 1}/`)),
    ).toBe("bad")
    expect(at(`/review/${REVIEW_WIRE}/diff/${c.commit}`)).toBe("bad")
    expect(at(`/review/${REVIEW_WIRE}/review/not-hex`)).toBe("bad")
    expect(at(`/review/${REVIEW_WIRE}/review/0123..not_hex`)).toBe("bad")
    // A folder state is a point of a range, never a revision.
    expect(at(`/review/${REVIEW_WIRE}/review/${folder.from}`)).toBe("bad")
    expect(at(`/review/${REVIEW_WIRE}/review/01..23..45`)).toBe("bad")
    expect(at(`${reviewUrl(c)}/more`)).toBe("bad")
    expect(at("/review/anything")).toBe("bad")
    expect(at("/review")).toBe("bad")
    expect(at("/reviews")).toBeNull()
    expect(at(`/offer/${REVIEW_WIRE}/review/${c.commit}`)).toBeNull()
    expect(at("/other")).toBeNull()
  })
})
