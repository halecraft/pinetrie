import {
  type BaseRecord,
  type CommitId,
  commitId,
  ERR,
  laneNameForThread,
  type OfferAcceptanceDecision,
  type OfferGather,
  type OfferInRepo,
  type OfferNow,
  type OfferRecord,
  type OfferSeen,
  type Placed,
  type RefreshFacts,
  type StackFacts,
  type StartRead,
  type ThreadName,
  type WorkChanges,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  ACCEPTED,
  BASE as BASE_RECORD,
  decodeStack,
  encodeUpdate,
  OFFER,
  offerRecord,
  planDescribeAgain,
  planDescribeAsk,
  planDescribeSettle,
  planOfferAcceptance,
  planRebuild,
  planRefresh,
  planStack,
  planStackEnded,
  planYourEdits,
  renderableMessage,
  setRecord,
} from "./index.ts"
import { offerAcceptanceDestinations, offerMoved } from "./offer.ts"
import { decodeUpdate } from "./update.ts"

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

describe("planRefresh", () => {
  const host = { reached: true, yoursChanged: false }
  const rev = (since = host) => ({ commit: TIP, change: "k", since })
  const read = (
    o: Partial<Extract<OfferInRepo, { kind: "offer" }>> = {},
  ): OfferInRepo => ({
    kind: "offer",
    bookmark: `pinetrie-offer/t-1`,
    revisions: [rev()],
    chained: true,
    ledger: { source: TIP, start: [BASE] },
    firstLine: "WIP (t-1): x",
    placed: true,
    onTarget: true,
    files: [],
    conflicts: [],
    startConflicts: [],
    ...o,
  })
  const facts = (
    offer: OfferInRepo | null,
    tip = TIP,
    start: readonly CommitId[] | StartRead = [BASE],
    work: WorkChanges = "some",
  ): RefreshFacts =>
    "kind" in start
      ? start.kind === "untraced"
        ? { kind: "untraced", offer }
        : { kind: "placed", place: placed(tip, start.start), work, offer }
      : { kind: "placed", place: placed(tip, start), work, offer }
  const placed = (tip: CommitId, start: readonly CommitId[]): Placed => ({
    kind: "placed",
    tip,
    base: { base: { kind: "accepted" }, start: BASE, source: BASE },
    state: "ok",
    target: commitId("l0"),
    start,
  })
  /** What `planRefresh` decides, by its kind. */
  const plan = (f: RefreshFacts) => planRefresh(f).kind
  test("no offer in your repo (never built, accepted, or gone): build, unless the lane holds nothing you lack, when a record left from one is forgotten", () => {
    expect(plan(facts(null))).toBe("build")
    expect(plan(facts(null, TIP, [TIP]))).toBe("forget")
  })
  test("a lane whose work changes no file is never built, and its offer is withdrawn unless you edited it", () => {
    expect(plan(facts(null, TIP, [BASE], "none"))).toBe("forget")
    expect(plan(facts(read(), TIP, [BASE], "none"))).toBe("withdraw")
    expect(plan(facts(read({ chained: false }), TIP, [BASE], "none"))).toBe(
      "leave",
    )
  })
  test("what jj could not tell never builds an offer, and keeps one that is there (ADR-0067)", () => {
    expect(plan(facts(null, TIP, [BASE], "unknown"))).toBe("forget")
    expect(plan(facts(read(), TIP, [BASE], "unknown"))).toBe("none")
    expect(plan(facts(read(), T2, [BASE], "unknown"))).toBe("rebuild")
  })
  test("an untraced start builds nothing, withdraws an offer, and leaves one you edited, or one divergent, untouched (S97)", () => {
    const untraced: StartRead = {
      kind: "untraced",
      acceptedOfferCommits: [BASE],
    }
    expect(plan(facts(null, TIP, untraced))).toBe("forget")
    expect(plan(facts(read(), TIP, untraced))).toBe("withdraw")
    expect(plan(facts(read({ chained: false }), TIP, untraced))).toBe(
      "untouched",
    )
    expect(
      plan(facts({ kind: "divergent", changes: ["k"] }, TIP, untraced)),
    ).toBe("untouched")
  })
  test("each decision carries what its steps need: the place, the offer, the changes", () => {
    const at = placed(TIP, [BASE])
    expect(planRefresh(facts(null))).toEqual({ kind: "build", place: at })
    expect(planRefresh(facts(read(), T2))).toEqual({
      kind: "rebuild",
      place: placed(T2, [BASE]),
      offer: read(),
    })
    expect(planRefresh(facts(read({ onTarget: false })))).toEqual({
      kind: "refresh",
      place: at,
      offer: read({ onTarget: false }),
    })
    expect(
      planRefresh(facts({ kind: "divergent", changes: ["ka", "kb"] })),
    ).toEqual({ kind: "repair", place: at, changes: ["ka", "kb"] })
    expect(planRefresh({ kind: "archived", offer: read() })).toEqual({
      kind: "withdraw",
      offer: read(),
    })
  })
  test("an archived thread's offer is withdrawn, an edited one too; with none, its record is forgotten", () => {
    expect(plan({ kind: "archived", offer: read() })).toBe("withdraw")
    expect(plan({ kind: "archived", offer: read({ chained: false }) })).toBe(
      "withdraw",
    )
    expect(
      plan({
        kind: "archived",
        offer: { kind: "divergent", changes: ["k"] },
      }),
    ).toBe("withdraw")
    expect(plan({ kind: "archived", offer: null })).toBe("forget")
  })
  test("only the target moved: refresh; nothing moved: none", () => {
    expect(plan(facts(read({ onTarget: false })))).toBe("refresh")
    expect(plan(facts(read()))).toBe("none")
  })
  test("the lane moved on: a single offer is rebuilt, a stack goes stale", () => {
    expect(plan(facts(read(), T2))).toBe("rebuild")
    expect(plan(facts(read({ revisions: [rev(), rev()] }), T2))).toBe("stale")
  })
  test("where it starts moved (you accepted part of it): the same, or withdraw when nothing is left", () => {
    expect(plan(facts(read(), TIP, [T2]))).toBe("rebuild")
    expect(
      plan(
        facts(read({ ledger: { source: TIP, start: [BASE, T2] } }), TIP, [
          T2,
          BASE,
        ]),
      ),
    ).toBe("none")
    expect(plan(facts(read({ revisions: [rev(), rev()] }), TIP, [T2]))).toBe(
      "stale",
    )
    expect(plan(facts(read(), TIP, [TIP]))).toBe("withdraw")
  })
  test("an offer with no ledger, built before ADR-0060, reads as moved: it is followed once", () => {
    expect(plan(facts(read({ ledger: null })))).toBe("rebuild")
  })
  test("you edited it: a version of yours that changed a revision, a commit of yours between, or its bottom moved (S48 item 7)", () => {
    const changed = { reached: true, yoursChanged: true }
    expect(plan(facts(read({ revisions: [rev(changed)] })))).toBe("leave")
    expect(plan(facts(read({ revisions: [rev(changed), rev()] }), T2))).toBe(
      "leave",
    )
    expect(plan(facts(read({ chained: false })))).toBe("leave")
    expect(plan(facts(read({ placed: false, onTarget: false })))).toBe("leave")
  })
  test("a revision the host never made is yours; a version only the host made is not (S73)", () => {
    expect(
      plan(
        facts(
          read({ revisions: [rev({ reached: false, yoursChanged: false })] }),
        ),
      ),
    ).toBe("leave")
    expect(plan(facts(read(), T2))).toBe("rebuild")
  })
  test("divergent: repair, before anything else", () => {
    expect(plan(facts({ kind: "divergent", changes: ["k"] }, TIP, [TIP]))).toBe(
      "repair",
    )
  })
})

describe("isWipLine, offerMoved, describeWanted", () => {
  const NAME = "t-1" as ThreadName
  const one = {
    kind: "offer" as const,
    bookmark: "pinetrie-offer/t-1",
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
    startConflicts: [],
  }
  test("offerMoved: the tip, or the start as a set, against the ledger; no ledger is moved", () => {
    const ledger = { source: TIP, start: [BASE, T2] }
    expect(offerMoved(ledger, { tip: TIP, start: [T2, BASE] })).toBe(false)
    expect(offerMoved(ledger, { tip: T2, start: [T2, BASE] })).toBe(true)
    expect(offerMoved(ledger, { tip: TIP, start: [BASE] })).toBe(true)
    expect(offerMoved(null, { tip: TIP, start: [BASE] })).toBe(true)
  })
  test("describeWanted: one revision, not yours, on its WIP line unless forced", () => {
    const asks = (offer: OfferInRepo | null, force: boolean) =>
      planDescribeAsk(
        {
          place: {
            kind: "placed",
            tip: TIP,
            base: { base: { kind: "accepted" }, start: BASE, source: BASE },
            state: "ok",
            target: T2,
            start: [BASE],
          },
          name: NAME,
          offer,
          base: {
            lane: LANE,
            base: { kind: "accepted" },
            start: BASE,
            state: "ok",
            catchUp: null,
            untraced: [],
            work: "some",
          },
        },
        force,
      ) !== null
    expect(asks(one, false)).toBe(true)
    expect(asks({ ...one, firstLine: "fix: x" }, false)).toBe(false)
    expect(asks({ ...one, firstLine: "fix: x" }, true)).toBe(true)
    expect(
      asks({ ...one, revisions: [...one.revisions, ...one.revisions] }, true),
    ).toBe(false)
    expect(asks({ ...one, chained: false }, true)).toBe(false)
    expect(asks(null, true)).toBe(false)
  })
})

describe("records", () => {
  test("an offer, accepted work and a base round-trip (ADR-0060)", () => {
    const o = setRecord(OFFER, offer)
    expect([o.namespace, o.key]).toEqual(["pinetrie.offer", LANE])
    expect(OFFER.decode(structuredClone(o.value), LANE)).toEqual(offer)
    expect(OFFER.decode({ ...offer, size: 0 }, LANE)).toBeUndefined()
    const line = {
      acceptedBookmark: "pinetrie-accepted",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit: COPY,
      heads: { current: null, proposed: "builtin_immutable_heads() | …" },
      log: { current: null, proposed: "builtin_log() | …" },
      wips: [{ bookmark: "wip/x", commit: TIP, behind: 1, ahead: 2 }],
      yours: {
        behind: 0,
        ahead: 0,
        catchUp: null,
        conflicts: { commits: 0, files: [] },
      },
      publishCatchesUp: true,
    }
    const l = setRecord(ACCEPTED, line)
    expect([l.namespace, l.key]).toEqual(["pinetrie.accepted", "accepted"])
    expect(ACCEPTED.decode(structuredClone(l.value), "accepted")).toEqual(line)
    const base: BaseRecord = {
      lane: LANE,
      base: { kind: "wip", bookmark: "wip/x" },
      start: COPY,
      state: "ok",
      catchUp: { tip: TIP, to: COPY, files: ["a.txt"] },
      untraced: [TIP],
      work: "some",
    }
    const b = setRecord(BASE_RECORD, base)
    expect([b.namespace, b.key]).toEqual(["pinetrie.base", LANE])
    expect(BASE_RECORD.decode(structuredClone(b.value), LANE)).toEqual(base)
    // One stored before what catching up changes was read: dropped, so the
    // page reads it as unknown until the host writes it again (ADR-0067).
    const {
      catchUp: _c,
      untraced: _u,
      ...before
    } = b.value as Record<string, unknown>
    expect(BASE_RECORD.decode(before, LANE)).toBeUndefined()
  })
  test("an offer stored before its commits were kept does not decode", () => {
    const { commits: _, ...before } = offer
    expect(OFFER.decode(before, LANE)).toBeUndefined()
  })
})

describe("the update and stack messages", () => {
  const details = {
    lane: LANE,
    from: { kind: "accepted" as const },
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
      content: "↓ caught up with accepted work: 2 files changed",
      merged: [COPY],
    })
    expect(m.content).toContain("Accepted work was merged into this thread")
    expect(m.details).toMatchObject({ base: "accepted", line: true })
    // An update stored before ADR-0100 named accepted work by its bookmark.
    expect(
      decodeUpdate({
        ...m,
        details: { ...m.details, base: "pinetrie-accepted", line: true },
      })?.from,
    ).toEqual({ kind: "accepted" })
    const wip = {
      ...details,
      from: { kind: "wip" as const, bookmark: "wip/a" },
    }
    expect(renderableMessage(encodeUpdate(wip, 5))).toMatchObject({
      content: "↓ caught up with wip/a: 2 files changed",
    })
  })
  test("an update from the thread it branched from names it, for the column and the model (ADR-0072)", () => {
    const fromParent = {
      ...details,
      from: {
        kind: "parent" as const,
        lane: laneNameForThread("p"),
        name: "amber-fox" as ThreadName,
      },
    }
    const m = encodeUpdate(fromParent, 5)
    expect(decodeUpdate(structuredClone(m))).toEqual(fromParent)
    expect(renderableMessage(m)).toEqual({
      role: "update",
      content: "↓ caught up with amber-fox: 2 files changed",
      merged: [COPY],
    })
    expect(m.content).toContain(
      "The work of the thread this one branched from (amber-fox) was merged",
    )
  })
  test("a stack message names where it starts and ends, and the bookmark to set", () => {
    const m = planStack({
      skill: { path: "/s", content: "Split well.", hash: "h" },
      bookmark: "pinetrie/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      timestamp: 1,
    })
    expect(m.content).toContain("`b0`")
    expect(m.content).toContain("`t1`")
    expect(m.content).toContain("jj bookmark set pinetrie/t-1-stack")
    expect(decodeStack(structuredClone(m))).toMatchObject({
      tip: TIP,
      skill: { hash: "h" },
    })
    expect(renderableMessage(m)).toMatchObject({ role: "stack" })
    expect(m.content).not.toContain("What the person asked")
  })
  test("a split card's text is the stack's brief, under its own heading, last (ADR-0080)", () => {
    const m = planStack({
      skill: null,
      bookmark: "pinetrie/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      intent: "  tests apart  ",
      timestamp: 1,
    })
    expect(m.content.endsWith("## What the person asked\n\ntests apart")).toBe(
      true,
    )
  })
})

describe("offerAcceptanceDestinations (ADR-0060)", () => {
  const line = { kind: "accepted" } as const
  const wip = { kind: "wip", bookmark: "wip/x" } as const
  const of = (
    over: Partial<Parameters<typeof offerAcceptanceDestinations>[0]> = {},
  ) =>
    offerAcceptanceDestinations({
      base: line,
      state: "ok",
      acceptedBookmark: "pinetrie-accepted",
      conflicted: false,
      wipAhead: 2,
      ...over,
    }).map(d => [d.bookmark, d.bringsAlong, d.final])
  test("a thread on accepted work: accepted work, final", () => {
    expect(of()).toEqual([["pinetrie-accepted", 0, true]])
  })
  test("a WIP thread: its WIP first, then accepted work with the WIP's commits", () => {
    expect(of({ base: wip })).toEqual([
      ["wip/x", 0, false],
      ["pinetrie-accepted", 2, true],
    ])
  })
  test("a conflicted offer never lands on accepted work: only into a WIP", () => {
    expect(of({ conflicted: true })).toEqual([])
    expect(of({ base: wip, conflicted: true })).toEqual([["wip/x", 0, false]])
  })
  test("a landed WIP is accepted work's; a gone one has none", () => {
    expect(of({ base: wip, state: "landed" })).toEqual([
      ["pinetrie-accepted", 0, true],
    ])
    expect(of({ base: wip, state: "gone" })).toEqual([])
  })
})

describe("the offer's policy over a gather (ADR-0038, ADR-0060)", () => {
  const NAME = "amber-fox" as ThreadName
  const NOT_YOURS = { reached: true, yoursChanged: false }
  const START = commitId("s0")
  const NEW_TIP = commitId("t9")
  const NOW_COMMIT = commitId("c5")
  const ACCEPTED_BASE = {
    base: { kind: "accepted" },
    start: START,
    source: START,
  } as const
  const at = (over: Partial<Placed> = {}): Placed => ({
    kind: "placed",
    tip: TIP,
    base: ACCEPTED_BASE,
    state: "ok",
    target: commitId("l1"),
    start: [START],
    ...over,
  })
  /** An offer as your repo holds it: one revision, the host's, on its WIP line. */
  const read = (over: Partial<OfferNow> = {}): OfferNow => ({
    kind: "offer",
    bookmark: `pinetrie-offer/${NAME}`,
    revisions: [{ commit: NOW_COMMIT, change: "kxyz", since: NOT_YOURS }],
    chained: true,
    ledger: { source: TIP, start: [START] },
    firstLine: `WIP (${NAME}): fix it`,
    placed: true,
    onTarget: true,
    files: ["a.txt"],
    conflicts: [],
    startConflicts: [],
    ...over,
  })
  const baseRecord: BaseRecord = {
    lane: LANE,
    base: { kind: "accepted" },
    start: START,
    state: "ok",
    catchUp: null,
    untraced: [],
    work: "some",
  }
  const gather = (over: Partial<OfferGather> = {}): OfferGather => ({
    place: at(),
    name: NAME,
    offer: read(),
    base: baseRecord,
    ...over,
  })

  describe("offerRecord: the page's cache, from the repo", () => {
    const record = (o = read(), tip = TIP) =>
      offerRecord({
        lane: LANE,
        name: NAME,
        offer: o,
        place: { tip, start: [START] },
        editing: new Set(["a.txt", "elsewhere.txt"]),
        now: 7,
      })
    test("each revision's commit as it is now, and what the page shows", () => {
      expect(record()).toEqual({
        lane: LANE,
        size: 1,
        stale: false,
        files: ["a.txt"],
        conflicts: [],
        startConflicts: [],
        yourEdits: ["a.txt"],
        described: false,
        edited: false,
        bookmark: "pinetrie-offer/amber-fox",
        acceptedAs: null,
        commits: [NOW_COMMIT],
        ledger: { source: TIP, start: [START] },
        at: 7,
      })
    })
    test("your edits are its files that @ changes, and only those", () => {
      expect(
        offerRecord({
          lane: LANE,
          name: NAME,
          offer: read({ files: ["a.txt", "b.txt"] }),
          place: { tip: TIP, start: [START] },
          editing: new Set(["b.txt", "c.txt"]),
          now: 1,
        }).yourEdits,
      ).toEqual(["b.txt"])
    })
    test("described once its first line is not the WIP line; edited once a version of yours changed it", () => {
      expect(record(read({ firstLine: "fix: it" })).described).toBe(true)
      const yours = read({
        revisions: [
          {
            commit: NOW_COMMIT,
            change: "kxyz",
            since: { reached: true, yoursChanged: true },
          },
        ],
      })
      expect(record(yours).edited).toBe(true)
    })
    test("a stack is stale when the lane moved past its ledger; a single offer never is", () => {
      const stack = read({
        revisions: [
          { commit: commitId("b1"), change: "kb", since: NOT_YOURS },
          { commit: commitId("b2"), change: "kt", since: NOT_YOURS },
        ],
      })
      expect(record(stack, NEW_TIP).stale).toBe(true)
      expect(record(stack, TIP).stale).toBe(false)
      expect(record(read(), NEW_TIP).stale).toBe(false)
    })
  })

  test("planYourEdits: each record's files that @ changes, open and held alike, until it is accepted", () => {
    const open = { ...offer, files: ["a.txt", "b.txt"], yourEdits: [] }
    const held = {
      ...offer,
      lane: laneNameForThread("2"),
      files: [],
      yourEdits: ["x"],
    }
    const accepted = {
      ...offer,
      lane: laneNameForThread("3"),
      acceptedAs: "kt",
    }
    expect(
      planYourEdits([open, held, accepted], new Set(["b.txt", "c.txt"])),
    ).toEqual([
      { ...open, yourEdits: ["b.txt"] },
      { ...held, yourEdits: [] },
    ])
  })

  describe("planOfferAcceptance (ADR-0060, ADR-0065)", () => {
    const o = read({
      revisions: [
        { commit: commitId("b1"), change: "kbot", since: NOT_YOURS },
        { commit: commitId("b2"), change: "ktop", since: NOT_YOURS },
      ],
    })
    const WIP_BASE = {
      base: { kind: "wip", bookmark: "wip/x" },
      start: START,
      source: START,
    } as const
    /** What the page drew: this offer's ledger, not conflicting. */
    const SHOWN = { ledger: o.ledger, conflicted: false }
    const BOTH = new Set(["wip/x", "pinetrie-accepted"])
    const accept = (
      over: {
        readonly to?: string | null
        readonly below?: ReadonlySet<string>
        readonly gathered?: OfferGather | null
        readonly seen?: OfferSeen | null
        readonly offer?: OfferInRepo
      } = {},
    ) =>
      planOfferAcceptance({
        lane: LANE,
        gathered:
          over.gathered === undefined
            ? gather({
                place: at({ base: WIP_BASE }),
                offer: over.offer ?? o,
              })
            : over.gathered,
        seen: over.seen === undefined ? SHOWN : over.seen,
        acceptance: { wipAhead: 2, below: over.below ?? BOTH },
        editing: new Set(),
        acceptedBookmark: "pinetrie-accepted",
        to: over.to ?? null,
        now: 9,
      })
    const outcome = (t: OfferAcceptanceDecision) =>
      t.kind === "accept" ? t.destination : t.code
    test("the default destination is the WIP, the offer's top, and the record marked accepted", () => {
      const record = offerRecord({
        lane: LANE,
        name: NAME,
        offer: o,
        place: { tip: TIP, start: [START] },
        editing: new Set(),
        now: 9,
      })
      expect(accept()).toEqual({
        kind: "accept",
        name: NAME,
        bookmark: record.bookmark,
        destination: "wip/x",
        top: "ktop",
        accepted: { ...record, acceptedAs: "ktop", at: 9 },
      })
      expect(outcome(accept({ to: "pinetrie-accepted" }))).toBe(
        "pinetrie-accepted",
      )
    })
    test("refused in order: no offer, a WIP gone, nothing shown, divergent, other work, no such destination", () => {
      expect(outcome(accept({ gathered: null }))).toBe(ERR.NO_OFFER)
      expect(outcome(accept({ gathered: gather({ offer: null }) }))).toBe(
        ERR.NO_OFFER,
      )
      expect(
        outcome(
          accept({
            gathered: gather({
              place: { kind: "gone", tip: TIP, base: WIP_BASE },
            }),
            seen: null,
          }),
        ),
      ).toBe(ERR.BAD_DESTINATION)
      expect(
        outcome(
          accept({
            seen: null,
            offer: { kind: "divergent", changes: ["k"] },
          }),
        ),
      ).toBe(ERR.OFFER_CHANGED)
      expect(
        outcome(accept({ offer: { kind: "divergent", changes: ["k"] } })),
      ).toBe(ERR.NO_OFFER)
      expect(outcome(accept({ to: "main" }))).toBe(ERR.BAD_DESTINATION)
      expect(outcome(accept({ below: new Set(["pinetrie-accepted"]) }))).toBe(
        ERR.BAD_DESTINATION,
      )
    })
    test("a conflicted offer never goes to accepted work; an untraced place is accepted where it sits", () => {
      const conflicted = { ...o, conflicts: ["a.txt"] }
      const shown = { ledger: o.ledger, conflicted: true }
      expect(outcome(accept({ offer: conflicted, seen: shown }))).toBe("wip/x")
      expect(
        outcome(
          accept({ offer: conflicted, seen: shown, to: "pinetrie-accepted" }),
        ),
      ).toBe(ERR.BAD_DESTINATION)
      const untraced = gather({
        place: {
          kind: "untraced",
          tip: TIP,
          base: ACCEPTED_BASE,
          state: "ok",
          target: commitId("l1"),
        },
        offer: o,
      })
      expect(outcome(accept({ gathered: untraced }))).toBe("pinetrie-accepted")
    })
    test.each([
      [
        "rebased onto a moved target, the same ledger",
        {
          offer: read({
            ...o,
            revisions: [
              { commit: commitId("c9"), change: "ktop", since: NOT_YOURS },
            ],
          }),
        },
        "wip/x",
      ],
      [
        "edited by you, the same ledger",
        {
          offer: read({
            ...o,
            revisions: [
              {
                commit: commitId("c9"),
                change: "ktop",
                since: { reached: true, yoursChanged: true },
              },
            ],
          }),
        },
        "wip/x",
      ],
      [
        "another ledger: the lane moved on",
        { offer: read({ ...o, ledger: { source: NEW_TIP, start: [START] } }) },
        ERR.OFFER_CHANGED,
      ],
      [
        "another start, the same source",
        {
          offer: read({
            ...o,
            ledger: { source: TIP, start: [START, NEW_TIP] },
          }),
        },
        ERR.OFFER_CHANGED,
      ],
      [
        "the same start, in another order",
        {
          offer: read({
            ...o,
            ledger: { source: TIP, start: [NEW_TIP, START] },
          }),
          seen: {
            ledger: { source: TIP, start: [START, NEW_TIP] },
            conflicted: false,
          },
        },
        "wip/x",
      ],
      [
        "newly conflicting",
        { offer: read({ ...o, conflicts: ["a.txt"] }) },
        ERR.OFFER_CHANGED,
      ],
      [
        "conflicting, as it was shown",
        {
          offer: read({ ...o, conflicts: ["a.txt"] }),
          seen: { ledger: o.ledger, conflicted: true },
        },
        "wip/x",
      ],
      [
        "shown no ledger, now one",
        { seen: { ledger: null, conflicted: false } },
        ERR.OFFER_CHANGED,
      ],
    ] as const)("an acceptance of the offer it was shown: %s", (_, over, expected) => {
      expect(outcome(accept(over))).toBe(expected)
    })
  })

  describe("planStackEnded and planRebuild: an offer built anew", () => {
    const span = { start: [commitId("s1")], tip: NEW_TIP }
    const sources = [
      { commit: commitId("r1"), description: "first" },
      { commit: commitId("r2"), description: "second" },
    ]
    const stack = (
      facts: StackFacts | "no-top" = { revisions: sources, differing: [] },
      gathered: OfferGather | null = gather(),
    ) => planStackEnded({ stack: span, facts, gathered })
    test("a stack of exactly the tip's files is built from its own start and tip, its revisions bottom first, the offer's abandoned", () => {
      expect(stack()).toEqual({
        kind: "rebuild",
        name: NAME,
        place: at({ tip: NEW_TIP, start: [commitId("s1")] }),
        changes: ["kxyz"],
        sources,
      })
    })
    test("refused, in words the agent reads: no top, no revisions, other files, no lane, no name, a WIP gone", () => {
      const why = (d: ReturnType<typeof stack>) =>
        d.kind === "refused" ? d.why : "rebuild"
      expect(why(stack("no-top"))).toBe("the stack's bookmark was not set")
      expect(why(stack({ revisions: [], differing: [] }))).toBe(
        "the stack has no revisions",
      )
      expect(
        why(stack({ revisions: sources, differing: ["b.txt"] })),
      ).toContain("b.txt")
      expect(why(stack(undefined, null))).toBe(
        "the thread's lane is not in your repo",
      )
      expect(why(stack(undefined, gather({ name: undefined })))).toBe(
        "the thread has no name yet",
      )
      expect(
        why(
          stack(
            undefined,
            gather({ place: { kind: "gone", tip: TIP, base: ACCEPTED_BASE } }),
          ),
        ),
      ).toBe("the thread's base is gone: continue it on accepted work")
    })
    test("an untraced place accepts a stack: it brings its own start", () => {
      const untraced = gather({
        place: {
          kind: "untraced",
          tip: TIP,
          base: ACCEPTED_BASE,
          state: "ok",
          target: commitId("l1"),
        },
      })
      expect(stack(undefined, untraced).kind).toBe("rebuild")
    })
    test("planRebuild: the lane's tip as one revision on its WIP line, from a known start only", () => {
      expect(planRebuild(gather(), "WIP (amber-fox): x")).toEqual({
        kind: "rebuild",
        name: NAME,
        place: at(),
        changes: ["kxyz"],
        sources: [{ commit: TIP, description: "WIP (amber-fox): x" }],
      })
      expect(planRebuild(null, "")).toEqual({
        kind: "refused",
        why: ERR.NO_OFFER,
      })
      expect(
        planRebuild(
          gather({ place: { kind: "gone", tip: TIP, base: ACCEPTED_BASE } }),
          "",
        ),
      ).toEqual({ kind: "refused", why: ERR.BAD_DESTINATION })
      expect(
        planRebuild(
          gather({
            place: {
              kind: "untraced",
              tip: TIP,
              base: ACCEPTED_BASE,
              state: "ok",
              target: commitId("l1"),
            },
          }),
          "",
        ),
      ).toEqual({ kind: "refused", why: ERR.NO_OFFER })
    })
  })

  describe("a commit message: asked, then settled (ADR-0038)", () => {
    test("planDescribeAsk: the offer's one revision while it is on its WIP line, or forced", () => {
      expect(planDescribeAsk(gather(), false)).toBe(NOW_COMMIT)
      expect(
        planDescribeAsk(
          gather({ offer: read({ firstLine: "fix: x" }) }),
          false,
        ),
      ).toBeNull()
      expect(
        planDescribeAsk(gather({ offer: read({ firstLine: "fix: x" }) }), true),
      ).toBe(NOW_COMMIT)
      expect(planDescribeAsk(gather({ name: undefined }), true)).toBeNull()
      expect(planDescribeAgain(gather())).toBeNull()
      expect(planDescribeAgain(gather({ offer: null }))).toBe(ERR.NO_OFFER)
    })
    test("planDescribeSettle: written only to the commit it was asked for, keeping the offer's ledger", () => {
      expect(
        planDescribeSettle({
          gathered: gather(),
          asked: NOW_COMMIT,
          force: false,
        }),
      ).toEqual({
        name: NAME,
        place: at(),
        change: "kxyz",
        ledger: { source: TIP, start: [START] },
      })
      expect(
        planDescribeSettle({
          gathered: gather(),
          asked: commitId("other"),
          force: false,
        }),
      ).toBeNull()
      const edited = read({ chained: false })
      expect(
        planDescribeSettle({
          gathered: gather({ offer: edited }),
          asked: NOW_COMMIT,
          force: true,
        }),
      ).toBeNull()
      expect(
        planDescribeSettle({
          gathered: gather({ offer: read({ ledger: null }) }),
          asked: NOW_COMMIT,
          force: false,
        })?.ledger,
      ).toEqual({ source: TIP, start: [START] })
    })
  })
})
