import {
  commitId,
  entryId,
  type HaveRecord,
  type LandingRecord,
  laneNameForThread,
  type OfferRecord,
  type RevisionRecord,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  acceptStack,
  answerDiff,
  answerReview,
  decodeHaveRecord,
  decodeOfferRecord,
  decodeStack,
  decodeUpdate,
  describeRequest,
  diffUrl,
  encodeUpdate,
  encodeWorkRecord,
  MAX_DIFF_BYTES,
  OFFER_WIRE,
  offerView,
  parseOfferPath,
  planOfferRead,
  planRefresh,
  planStack,
  type RefreshFacts,
  renderableMessage,
  reviewUrl,
  updatePrefill,
  wipDescription,
  withoutTrailers,
  withTrailers,
} from "./index.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada@x.io")
const TIP = commitId("t1")
const T2 = commitId("t2")
const BASE = commitId("b0")
const COPY = commitId("k1")

const offer: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pineta-offer/t-1",
  taken: null,
  commits: [commitId("w1")],
  at: 10,
  host: { changes: ["ch1"], wrote: [commitId("w1")], tip: TIP, start: [BASE] },
}

describe("offerView: ADR-0038's table", () => {
  const view = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" | "split" = "idle",
    landing?: LandingRecord,
  ) => offerView({ offer: o, activity, landing })
  const at = (v: ReturnType<typeof view>) => [v.state, v.buttons, v.menu]
  test("every state, with its buttons", () => {
    expect(at(view(undefined))).toEqual(["nothing", [], ["update"]])
    expect(at(view(offer, "turn"))).toEqual(["running", [], []])
    expect(at(view(offer, "resolution"))).toEqual(["busy", [], []])
    expect(at(view(offer, "split"))).toEqual(["busy", [], []])
    expect(at(view(offer))).toEqual([
      "ready",
      ["take", "split"],
      ["describe", "update"],
    ])
    expect(at(view({ ...offer, conflicts: ["a.txt"] }))).toEqual([
      "conflicts",
      ["resolve", "take"],
      [],
    ])
    expect(at(view({ ...offer, size: 2 }))).toEqual([
      "stack",
      ["take", "squash"],
      ["update"],
    ])
    expect(at(view({ ...offer, size: 2, stale: true }))).toEqual([
      "stale",
      ["split", "take"],
      ["update"],
    ])
    expect(at(view({ ...offer, edited: true }))).toEqual([
      "edited",
      ["take", "refresh"],
      ["update"],
    ])
    expect(at(view({ ...offer, taken: "zz12345678" }))).toEqual([
      "taken",
      [],
      ["update"],
    ])
  })
  test("files you are editing are a fact; the state and buttons stay", () => {
    const v = view({ ...offer, yourEdits: ["b.txt"] })
    expect([v.state, v.buttons, v.facts.touchesYourEdits]).toEqual([
      "ready",
      ["take", "split"],
      true,
    ])
    expect(view(offer).facts.touchesYourEdits).toBe(false)
  })
  test("the facts: an untaken offer's bookmark, files and size", () => {
    expect(view({ ...offer, size: 2 }).facts).toEqual({
      activity: "idle",
      files: 2,
      size: 2,
      conflicts: 0,
      touchesYourEdits: false,
      bookmark: "pineta-offer/t-1",
      taken: null,
    })
    expect(view(offer, "turn").facts.files).toBe(2)
    const none = view(undefined).facts
    expect([none.files, none.bookmark, none.taken]).toEqual([0, null, null])
    const taken = view({ ...offer, taken: "zz12345678" }).facts
    expect([taken.files, taken.bookmark, taken.taken]).toEqual([
      0,
      null,
      "zz12345678",
    ])
  })
  test("a resolution that asked you counts only when newer than the offer", () => {
    const asked: LandingRecord = {
      id: "l",
      lane: LANE,
      prompt: entryId("e"),
      state: "needs_you",
      by: ADA,
      at: 20,
    }
    expect(view(offer, "idle", asked).state).toBe("needs_you")
    expect(view(offer, "idle", { ...asked, at: 5 }).state).toBe("ready")
  })
})

describe("planRefresh", () => {
  const clean = { sameDescription: true, sameChange: true }
  const facts = (
    o: Partial<NonNullable<RefreshFacts["offer"]>> | undefined,
    tip = TIP,
    start = [BASE],
  ): RefreshFacts => ({
    tip,
    start,
    offer:
      o === undefined
        ? undefined
        : {
            size: 1,
            taken: null,
            builtFrom: TIP,
            builtOn: [BASE],
            revisions: [clean],
            placed: true,
            onTarget: true,
            divergent: false,
            ...o,
          },
  })
  test("no offer: build, unless the lane holds nothing you lack", () => {
    expect(planRefresh(facts(undefined))).toBe("build")
    expect(planRefresh(facts(undefined, TIP, [TIP]))).toBe("none")
    expect(planRefresh({ tip: null, start: [], offer: undefined })).toBe("none")
    expect(planRefresh(facts({ taken: "c" }))).toBe("build")
  })
  test("only the target moved: refresh; nothing moved: none", () => {
    expect(planRefresh(facts({ onTarget: false }))).toBe("refresh")
    expect(planRefresh(facts({}))).toBe("none")
  })
  test("the lane moved on: a single offer follows, a stack goes stale", () => {
    expect(planRefresh(facts({ builtFrom: T2 }))).toBe("follow")
    expect(
      planRefresh(facts({ builtFrom: T2, size: 2, revisions: [clean, clean] })),
    ).toBe("stale")
  })
  test("where it starts moved (you took part of it): the same, or withdraw when nothing is left", () => {
    expect(planRefresh(facts({ builtOn: [T2] }))).toBe("follow")
    expect(planRefresh(facts({ builtOn: [BASE, T2] }, TIP, [T2, BASE]))).toBe(
      "none",
    )
    expect(
      planRefresh(facts({ size: 2, revisions: [clean, clean] }, TIP, [T2])),
    ).toBe("stale")
    expect(planRefresh(facts({}, TIP, [TIP]))).toBe("withdraw")
    expect(
      planRefresh(
        facts(
          { revisions: [{ sameDescription: false, sameChange: true }] },
          TIP,
          [T2],
        ),
      ),
    ).toBe("leave")
  })
  test("any failed edit test, on any revision, leaves it alone (S48 item 7)", () => {
    expect(planRefresh(facts({ placed: false, onTarget: false }))).toBe("leave")
    expect(
      planRefresh(
        facts({ revisions: [{ sameDescription: false, sameChange: true }] }),
      ),
    ).toBe("leave")
    expect(
      planRefresh(
        facts({
          size: 2,
          revisions: [{ sameDescription: true, sameChange: false }, clean],
        }),
      ),
    ).toBe("leave")
  })
  test("divergent: repair, before anything else", () => {
    expect(planRefresh(facts({ divergent: true, placed: false }))).toBe(
      "repair",
    )
  })
})

test("acceptStack: exactly the tip's files, or refused naming what differs", () => {
  expect(acceptStack({ revisions: 2, differing: [] })).toEqual({ ok: true })
  expect(acceptStack({ revisions: 2, differing: ["b.txt"] })).toMatchObject({
    ok: false,
    reason: expect.stringContaining("b.txt"),
  })
  expect(acceptStack({ revisions: 0, differing: [] })).toMatchObject({
    ok: false,
  })
})

describe("the commit message", () => {
  test("describeRequest: the thread's messages go first, then the diff; never the skill", () => {
    const skill = "Write a commit message."
    const full = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["first", "second"],
      recent: ["feat: a thing"],
      budget: 10_000,
    })
    expect(full.system).toBe(skill)
    expect(full.user).toContain("- first")
    expect(full.user).toContain("d".repeat(100))
    const tight = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["an early one", "x"],
      recent: [],
      budget: 190,
    })
    expect(tight.system).toBe(skill)
    expect(tight.user).not.toContain("an early one")
    expect(tight.user).toContain("d".repeat(100))
    const tighter = describeRequest({
      skill,
      diff: "d".repeat(500),
      messages: ["m"],
      recent: [],
      budget: 200,
    })
    expect(tighter.user).toContain("the rest of the diff left out")
  })
  test("withoutTrailers undoes withTrailers, and keeps your own", () => {
    const at = { lane: LANE, name: "amber-fox" as ThreadName, entry: "e9" }
    const m = "feat: x\n\nwhy it changed\n"
    expect(withoutTrailers(withTrailers(m, at))).toBe(m.trim())
    const yours = "feat: x\n\nSigned-off-by: Ada <ada@x.io>"
    expect(withoutTrailers(withTrailers(yours, at))).toBe(yours)
    expect(
      withoutTrailers(`feat: x\n\nSigned-off-by: Ada\nPineta-Entry: e1`),
    ).toBe("feat: x\n\nSigned-off-by: Ada\nPineta-Entry: e1")
    expect(withoutTrailers("Pineta-Entry: e1")).toBe("Pineta-Entry: e1")
  })
  test("withTrailers and the WIP line", () => {
    const name = "amber-fox" as ThreadName
    expect(withTrailers("feat: x\n", { lane: LANE, name, entry: "e9" })).toBe(
      `feat: x\n\nPineta-Thread: amber-fox\nPineta-Lane: ${LANE}\nPineta-Entry: e9\n`,
    )
    expect(wipDescription(name, "add the offer line\nmore")).toBe(
      "WIP (amber-fox): add the offer line",
    )
    expect(wipDescription(name, "")).toBe("WIP (amber-fox): this thread's work")
  })
})

describe("records", () => {
  test("an offer and a have round-trip, keyed by lane and by commit", () => {
    const o = encodeWorkRecord({ kind: "offer", record: offer })
    expect([o.namespace, o.key]).toEqual(["pineta.offer", LANE])
    expect(decodeOfferRecord(structuredClone(o.value))).toEqual(offer)
    const h: HaveRecord = { lane: LANE, commit: COPY, kind: "copy", at: 3 }
    const e = encodeWorkRecord({ kind: "have", record: h })
    expect([e.namespace, e.key]).toEqual(["pineta.have", COPY])
    expect(decodeHaveRecord(structuredClone(e.value))).toEqual(h)
    expect(decodeOfferRecord({ ...offer, size: 0 })).toBeUndefined()
  })
  test("an offer stored before its commits were kept does not decode", () => {
    const { commits: _, ...before } = offer
    expect(decodeOfferRecord(before)).toBeUndefined()
  })
})

describe("the review (ADR-0047)", () => {
  const C1 = commitId("c1")
  const C2 = commitId("c2")
  const open: OfferRecord = { ...offer, commits: [C1, C2] }
  const offers = new Map([[LANE, open]])
  const facts = (
    o: ReadonlyMap<string, OfferRecord>,
    revisions: ReadonlyMap<string, RevisionRecord> = new Map(),
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
    const status = (o: ReadonlyMap<string, OfferRecord>, commit: string) => {
      const read = planOfferRead(facts(o), {
        kind: "review",
        span: rev(commit),
      })
      return read.kind === "refused" ? read.status : read.kind
    }
    // What the host last wrote is not what the offer is now.
    expect(status(offers, "w1")).toBe(404)
    expect(status(offers, "ffff")).toBe(404)
    const taken = new Map([[LANE, { ...open, taken: "t" }]])
    expect(status(taken, C1)).toBe(404)
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
        entry,
        {
          entry: entryId(entry),
          lane,
          commit: commitId(commit),
          snapshot: null,
          paths: [],
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

describe("the update and stack messages", () => {
  const details = {
    lane: LANE,
    copy: COPY,
    commits: ["feat: yours"],
    files: ["a.txt", "c.txt"],
    by: ADA,
  }
  test("an update round-trips, shows one line, and tells the model what changed", () => {
    const m = encodeUpdate(details, 5)
    expect(decodeUpdate(structuredClone(m))).toEqual(details)
    expect(m.content).toContain("- c.txt")
    expect(renderableMessage(m)).toEqual({
      role: "update",
      content: "↓ your work merged in: 2 files changed",
    })
    expect(updatePrefill(details)).toContain("2 files changed")
  })
  test("a stack message names where it starts and ends, and the bookmark to set", () => {
    const m = planStack({
      skill: { path: "/s", content: "Split well.", hash: "h" },
      bookmark: "pineta/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      timestamp: 1,
    })
    expect(m.content).toContain("`b0`")
    expect(m.content).toContain("`t1`")
    expect(m.content).toContain("jj bookmark set pineta/t-1-stack")
    expect(decodeStack(structuredClone(m))).toMatchObject({
      tip: TIP,
      skill: { hash: "h" },
    })
    expect(renderableMessage(m)).toMatchObject({ role: "stack" })
  })
})
