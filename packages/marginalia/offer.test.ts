import {
  commitId,
  type EntryId,
  entryId,
  type LandingRecord,
  type LaneName,
  laneNameForThread,
  type OfferInRepo,
  type OfferRecord,
  type RevisionRecord,
  type ThreadName,
  TRAILERS,
  trailerValues,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  acceptStack,
  answerDiff,
  answerReview,
  decodeBaseRecord,
  decodeLineRecord,
  decodeOfferRecord,
  decodeStack,
  decodeUpdate,
  describeRequest,
  describeWanted,
  diffUrl,
  encodeUpdate,
  encodeWorkRecord,
  isWipLine,
  MAX_DIFF_BYTES,
  OFFER_WIRE,
  offerMoved,
  offerView,
  parseOfferPath,
  planOfferRead,
  planRefresh,
  planStack,
  type RefreshFacts,
  renderableMessage,
  reviewUrl,
  takeDestinations,
  wipDescription,
  withLedger,
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
}

describe("offerView: ADR-0038's table", () => {
  const view = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" | "split" = "idle",
    landing?: LandingRecord,
  ) =>
    offerView({
      offer: o,
      activity,
      landing,
      base: null,
      onto: "pineta-onto",
      wipAhead: 0,
    })
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
    // Only a clean offer lands on the line (ADR-0060): no take on a line thread.
    expect(at(view({ ...offer, conflicts: ["a.txt"] }))).toEqual([
      "conflicts",
      ["resolve"],
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
      base: "pineta-onto",
      onto: "pineta-onto",
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
  const host = { reached: true, yoursChanged: false }
  const rev = (since = host) => ({ commit: TIP, change: "k", since })
  const read = (
    o: Partial<Extract<OfferInRepo, { kind: "offer" }>> = {},
  ): OfferInRepo => ({
    kind: "offer",
    revisions: [rev()],
    chained: true,
    ledger: { source: TIP, start: [BASE] },
    firstLine: "WIP (t-1): x",
    placed: true,
    onTarget: true,
    files: [],
    conflicts: [],
    ...o,
  })
  const facts = (
    offer: OfferInRepo | null,
    tip = TIP,
    start = [BASE],
  ): RefreshFacts => ({ tip, start, offer })
  test("no offer in your repo (never built, taken, or gone): build, unless the lane holds nothing you lack", () => {
    expect(planRefresh(facts(null))).toBe("build")
    expect(planRefresh(facts(null, TIP, [TIP]))).toBe("none")
    expect(planRefresh({ tip: null, start: [], offer: null })).toBe("none")
  })
  test("only the target moved: refresh; nothing moved: none", () => {
    expect(planRefresh(facts(read({ onTarget: false })))).toBe("refresh")
    expect(planRefresh(facts(read()))).toBe("none")
  })
  test("the lane moved on: a single offer follows, a stack goes stale", () => {
    expect(planRefresh(facts(read(), T2))).toBe("follow")
    expect(planRefresh(facts(read({ revisions: [rev(), rev()] }), T2))).toBe(
      "stale",
    )
  })
  test("where it starts moved (you took part of it): the same, or withdraw when nothing is left", () => {
    expect(planRefresh(facts(read(), TIP, [T2]))).toBe("follow")
    expect(
      planRefresh(
        facts(read({ ledger: { source: TIP, start: [BASE, T2] } }), TIP, [
          T2,
          BASE,
        ]),
      ),
    ).toBe("none")
    expect(
      planRefresh(facts(read({ revisions: [rev(), rev()] }), TIP, [T2])),
    ).toBe("stale")
    expect(planRefresh(facts(read(), TIP, [TIP]))).toBe("withdraw")
  })
  test("an offer with no ledger, built before ADR-0060, reads as moved: it is followed once", () => {
    expect(planRefresh(facts(read({ ledger: null })))).toBe("follow")
  })
  test("you edited it: a version of yours that changed a revision, a commit of yours between, or its bottom moved (S48 item 7)", () => {
    const changed = { reached: true, yoursChanged: true }
    expect(planRefresh(facts(read({ revisions: [rev(changed)] })))).toBe(
      "leave",
    )
    expect(
      planRefresh(facts(read({ revisions: [rev(changed), rev()] }), T2)),
    ).toBe("leave")
    expect(planRefresh(facts(read({ chained: false })))).toBe("leave")
    expect(planRefresh(facts(read({ placed: false, onTarget: false })))).toBe(
      "leave",
    )
  })
  test("a revision the host never made is yours; a version only the host made is not (S73)", () => {
    expect(
      planRefresh(
        facts(
          read({ revisions: [rev({ reached: false, yoursChanged: false })] }),
        ),
      ),
    ).toBe("leave")
    expect(planRefresh(facts(read(), T2))).toBe("follow")
  })
  test("divergent: repair, before anything else", () => {
    expect(
      planRefresh(facts({ kind: "divergent", changes: ["k"] }, TIP, [TIP])),
    ).toBe("repair")
  })
})

describe("isWipLine, offerMoved, describeWanted", () => {
  const NAME = "t-1" as ThreadName
  const one = {
    kind: "offer" as const,
    revisions: [
      {
        commit: TIP,
        change: "k",
        since: { reached: true, yoursChanged: false },
      },
    ],
    chained: true,
    ledger: { source: TIP, start: [BASE] },
    firstLine: "WIP (t-1): x",
    placed: true,
    onTarget: true,
    files: [],
    conflicts: [],
  }
  test("the WIP line is this thread's; an agent's message is not", () => {
    expect(isWipLine(NAME, "WIP (t-1): x")).toBe(true)
    expect(isWipLine(NAME, "fix: x")).toBe(false)
    expect(isWipLine(NAME, "WIP (t-2): x")).toBe(false)
  })
  test("offerMoved: the tip, or the start as a set, against the ledger; no ledger is moved", () => {
    const ledger = { source: TIP, start: [BASE, T2] }
    expect(offerMoved(ledger, { tip: TIP, start: [T2, BASE] })).toBe(false)
    expect(offerMoved(ledger, { tip: T2, start: [T2, BASE] })).toBe(true)
    expect(offerMoved(ledger, { tip: TIP, start: [BASE] })).toBe(true)
    expect(offerMoved(null, { tip: TIP, start: [BASE] })).toBe(true)
  })
  test("describeWanted: one revision, not yours, on its WIP line unless forced", () => {
    expect(describeWanted(one, NAME, false)).toBe(true)
    expect(describeWanted({ ...one, firstLine: "fix: x" }, NAME, false)).toBe(
      false,
    )
    expect(describeWanted({ ...one, firstLine: "fix: x" }, NAME, true)).toBe(
      true,
    )
    expect(
      describeWanted(
        { ...one, revisions: [...one.revisions, ...one.revisions] },
        NAME,
        true,
      ),
    ).toBe(false)
    expect(describeWanted({ ...one, chained: false }, NAME, true)).toBe(false)
    expect(describeWanted(null, NAME, true)).toBe(false)
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
  test("an offer, the line and a base round-trip (ADR-0060)", () => {
    const o = encodeWorkRecord({ kind: "offer", record: offer })
    expect([o.namespace, o.key]).toEqual(["pineta.offer", LANE])
    expect(decodeOfferRecord(structuredClone(o.value))).toEqual(offer)
    expect(decodeOfferRecord({ ...offer, size: 0 })).toBeUndefined()
    const line = {
      onto: "pineta-onto",
      wipPrefix: "wip/",
      commit: COPY,
      heads: { current: null, proposed: "builtin_immutable_heads() | …" },
      log: { current: null, proposed: "builtin_log() | …" },
      wips: [{ bookmark: "wip/x", commit: TIP, behind: 1, ahead: 2 }],
      yours: { behind: 0, ahead: null },
      commands: true,
    }
    const l = encodeWorkRecord({ kind: "line", record: line })
    expect([l.namespace, l.key]).toEqual(["pineta.line", "line"])
    expect(decodeLineRecord(structuredClone(l.value))).toEqual(line)
    const base = {
      lane: LANE,
      base: { kind: "wip", bookmark: "wip/x" },
      start: COPY,
      state: "ok",
    } as const
    const b = encodeWorkRecord({ kind: "base", record: base })
    expect([b.namespace, b.key]).toEqual(["pineta.base", LANE])
    expect(decodeBaseRecord(structuredClone(b.value))).toEqual(base)
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
        entryId(entry),
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
    base: "pineta-onto",
    merged: COPY,
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
      content: "↓ brought up to date with pineta-onto: 2 files changed",
    })
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

describe("takeDestinations (ADR-0060)", () => {
  const line = { kind: "line" } as const
  const wip = { kind: "wip", bookmark: "wip/x" } as const
  const of = (over: Partial<Parameters<typeof takeDestinations>[0]> = {}) =>
    takeDestinations({
      base: line,
      state: "ok",
      onto: "pineta-onto",
      conflicted: false,
      wipAhead: 2,
      ...over,
    }).map(d => [d.bookmark, d.bringsAlong, d.final])
  test("a line thread: the line, final", () => {
    expect(of()).toEqual([["pineta-onto", 0, true]])
  })
  test("a WIP thread: its WIP first, then the line with the WIP's commits", () => {
    expect(of({ base: wip })).toEqual([
      ["wip/x", 0, false],
      ["pineta-onto", 2, true],
    ])
  })
  test("a conflicted offer never lands on the line: only into a WIP", () => {
    expect(of({ conflicted: true })).toEqual([])
    expect(of({ base: wip, conflicted: true })).toEqual([["wip/x", 0, false]])
  })
  test("a landed WIP is the line's; a gone one has none", () => {
    expect(of({ base: wip, state: "landed" })).toEqual([
      ["pineta-onto", 0, true],
    ])
    expect(of({ base: wip, state: "gone" })).toEqual([])
  })
})

describe("withLedger (ADR-0060)", () => {
  const ledger = {
    source: commitId("t1"),
    start: [commitId("s1"), commitId("s2")],
  }
  test("joins the host's trailer paragraph, read back from it", () => {
    const m = withLedger(
      withTrailers("feat: x", {
        lane: LANE,
        name: "amber-fox" as ThreadName,
        entry: "e",
      }),
      ledger,
    )
    expect(m.split("\n\n")).toHaveLength(2)
    expect(trailerValues(m, TRAILERS.source)).toEqual(["t1"])
    expect(trailerValues(m, TRAILERS.start)).toEqual(["s1", "s2"])
    expect(withoutTrailers(m)).toBe("feat: x")
  })
  test("a message with no trailers gets a paragraph of its own", () => {
    expect(withLedger("WIP (amber-fox): x", ledger).split("\n\n")).toHaveLength(
      2,
    )
  })
})
