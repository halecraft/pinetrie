import {
  commitId,
  type EntryId,
  entryId,
  type LaneName,
  laneNameForThread,
  type OfferRecord,
  type RevisionRecord,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  answerDiff,
  answerReview,
  diffUrl,
  parseOfferPath,
  planOfferRead,
  reviewUrl,
} from "./index.ts"
import { MAX_DIFF_BYTES, OFFER_WIRE } from "./review.ts"

const LANE = laneNameForThread("1")
const _ADA = writerId("ada@x.io")
const _TIP = commitId("t1")
const _T2 = commitId("t2")
const _BASE = commitId("b0")
const _COPY = commitId("k1")

const offer: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pinetrie-offer/t-1",
  acceptedAs: null,
  commits: [commitId("w1")],
  ledger: null,
  at: 10,
}

describe("the review (ADR-0047)", () => {
  const C1 = commitId("c1")
  const C2 = commitId("c2")
  const open: OfferRecord = { ...offer, commits: [C1, C2] }
  const offers = new Map([[LANE, open]])
  const facts = (
    o: ReadonlyMap<LaneName, OfferRecord>,
    revisions: ReadonlyMap<EntryId, RevisionRecord> = new Map(),
  ) => ({ offers: o, revisions })
  const rev = (c: string) => ({ kind: "revision", commit: c }) as const
  test("planOfferRead: only a commit an open offer holds now", () => {
    expect(
      planOfferRead(facts(offers), { kind: "review", span: rev(C2) }),
    ).toEqual({
      kind: "review",
      span: rev(C2),
    })
    expect(
      planOfferRead(facts(offers), {
        kind: "diff",
        span: rev(C1),
        path: "a b.txt",
      }),
    ).toEqual({ kind: "diff", span: rev(C1), path: "a b.txt" })
    const status = (o: ReadonlyMap<LaneName, OfferRecord>, commit: string) => {
      const read = planOfferRead(facts(o), {
        kind: "review",
        span: rev(commit),
      })
      return read.kind === "refused" ? read.status : read.kind
    }
    // A commit the offer no longer is, and one it never was.
    expect(status(offers, "w1")).toBe(404)
    expect(status(offers, "ffff")).toBe(404)
    const accepted = new Map([[LANE, { ...open, acceptedAs: "t" }]])
    expect(status(accepted, C1)).toBe(404)
    // One the line already holds brings nothing to review.
    const held = new Map([[LANE, { ...open, files: [] }]])
    expect(status(held, C1)).toBe(404)
    const path = (p: string) => {
      const read = planOfferRead(facts(offers), {
        kind: "diff",
        span: rev(C1),
        path: p,
      })
      return read.kind === "refused" ? read.status : read.kind
    }
    expect([path(""), path("a\nb"), path("a\u007f")]).toEqual([400, 400, 400])
  })
  test("planOfferRead: a range only between two commits one lane's turns recorded (ADR-0056)", () => {
    const OTHER = laneNameForThread("other")
    const record = (entry: string, lane: typeof LANE, commit: string) =>
      [
        entryId(entry),
        {
          entry: entryId(entry),
          lane,
          commit: commitId(commit),
          snapshot: null,
          paths: [],
          conflicts: [],
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
      planOfferRead(facts(new Map(), revisions), {
        kind: "review",
        span: range(from, to),
      })
    expect(read("a1", "a2")).toEqual({
      kind: "review",
      span: range("a1", "a2"),
    })
    expect(read("a1", "b1")).toMatchObject({ kind: "refused", status: 404 })
    expect(read("a1", "ffff")).toMatchObject({ kind: "refused", status: 404 })
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
        },
      ],
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
    const at = (u: string) => parseOfferPath(new URL(u, "http://host"))
    const c = { kind: "revision", commit: commitId("0123abcd") } as const
    const r = {
      kind: "range",
      from: commitId("0123abcd"),
      to: commitId("4567ef"),
    } as const
    for (const span of [c, r]) {
      expect(at(reviewUrl(span))).toEqual({ kind: "review", span })
      for (const path of ["a b.txt", 'we"ird', "q?x&y#z", "dir/é.md"])
        expect(at(diffUrl(span, path))).toEqual({ kind: "diff", span, path })
    }
    expect(
      at(reviewUrl(c).replace(`/${OFFER_WIRE}/`, `/${OFFER_WIRE + 1}/`)),
    ).toBe("bad")
    expect(at(`/offer/${OFFER_WIRE}/diff/${c.commit}`)).toBe("bad")
    expect(at(`/offer/${OFFER_WIRE}/review/not-hex`)).toBe("bad")
    expect(at(`/offer/${OFFER_WIRE}/review/0123..not-hex`)).toBe("bad")
    expect(at(`/offer/${OFFER_WIRE}/review/01..23..45`)).toBe("bad")
    expect(at(`${reviewUrl(c)}/more`)).toBe("bad")
    expect(at("/offer/anything")).toBe("bad")
    expect(at("/offer")).toBe("bad")
    expect(at("/offers")).toBeNull()
    expect(at("/other")).toBeNull()
  })
})
