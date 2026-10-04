import {
  type BaseRecord,
  commitId,
  ERR,
  type LaneName,
  type LineRecord,
  laneNameForThread,
  type OfferInRepo,
  type OfferSeen,
  type ThreadName,
} from "@pineta/core"
import { DEFAULT_LINE } from "@pineta/lanes"
import { BASE, offerMessage, setIfChanged } from "@pineta/marginalia"
import {
  immutableHeads,
  logRevset,
  type Moved,
  planAbandonOffer,
  planFollow,
  planFollowOffer,
  planLand,
  planLineSetup,
  planTakeOffer,
} from "@pineta/repo"
import { describe, expect, test } from "vitest"
import {
  type BaseNow,
  offerRecord,
  planLineAction,
  planLineRecord,
  planMarks,
  planOfferEffects,
  planTake,
  type RefreshContext,
} from "./plan.ts"

const LANE = laneNameForThread("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const NEW_TIP = commitId("22222222")
const START = commitId("33333333")
const NOW_COMMIT = commitId("55555555")
const NOT_YOURS = { reached: true, yoursChanged: false }

/** An offer as your repo holds it: one revision, the host's, on its WIP line. */
const offer = (
  over: Partial<Extract<OfferInRepo, { kind: "offer" }>> = {},
): Extract<OfferInRepo, { kind: "offer" }> => ({
  kind: "offer",
  revisions: [{ commit: NOW_COMMIT, change: "kxyz", since: NOT_YOURS }],
  chained: true,
  ledger: { source: TIP, start: [START] },
  firstLine: `WIP (${NAME}): fix it`,
  placed: true,
  onTarget: true,
  files: ["a.txt"],
  conflicts: [],
  ...over,
})

const TRAILERS = { lane: LANE, name: NAME, entry: "e1" }
/** The lane's base record, as the repo says it and as the page has it. */
const BASE_RECORD: BaseRecord = {
  lane: LANE,
  base: { kind: "line" },
  start: START,
  state: "ok",
  catchUp: null,
  untraced: [],
}
const UNCHANGED = { next: BASE_RECORD, stored: BASE_RECORD }
const context = (read: OfferInRepo | null): RefreshContext => ({
  base: UNCHANGED,
  place: { tip: NEW_TIP, start: [START], target: "@-" },
  wip: "WIP (amber-fox): fix it",
  trailers: TRAILERS,
  offer: read,
})

describe("offerRecord: the page's cache, from the repo", () => {
  const record = (o = offer(), tip = TIP) =>
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
      yourEdits: ["a.txt"],
      described: false,
      edited: false,
      bookmark: "pineta-offer/amber-fox",
      taken: null,
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
        offer: offer({ files: ["a.txt", "b.txt"] }),
        place: { tip: TIP, start: [START] },
        editing: new Set(["b.txt", "c.txt"]),
        now: 1,
      }).yourEdits,
    ).toEqual(["b.txt"])
  })
  test("described once its first line is not the WIP line; edited once a version of yours changed it", () => {
    expect(record(offer({ firstLine: "fix: it" })).described).toBe(true)
    const yours = offer({
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
    const stack = offer({
      revisions: [
        { commit: commitId("b1"), change: "kb", since: NOT_YOURS },
        { commit: commitId("b2"), change: "kt", since: NOT_YOURS },
      ],
    })
    expect(record(stack, NEW_TIP).stale).toBe(true)
    expect(record(stack, TIP).stale).toBe(false)
    expect(record(offer(), NEW_TIP).stale).toBe(false)
  })
})

describe("planOfferEffects", () => {
  test("follow: planFollowOffer's steps, its WIP line with the host's trailers and the new ledger, then a record", () => {
    const e = planOfferEffects("follow", context(offer()))
    expect(e.steps).toEqual(
      planFollowOffer({
        change: "kxyz",
        start: [START],
        tip: NEW_TIP,
        target: "@-",
        description: offerMessage("WIP (amber-fox): fix it", {
          ...TRAILERS,
          ledger: { source: NEW_TIP, start: [START] },
        }),
      }),
    )
    expect(e.after).toEqual({ kind: "record" })
    expect(e.built).toBe(true)
  })

  test("none, stale and leave run nothing and record: the read made before planning is still the offer", () => {
    for (const plan of ["none", "stale", "leave"] as const)
      expect(planOfferEffects(plan, context(offer()))).toEqual({
        writes: [],
        steps: [],
        after: { kind: "record" },
        built: false,
      })
  })

  test("withdraw plans the abandon, then the record's removal", () => {
    const e = planOfferEffects("withdraw", context(offer()))
    expect(e.steps).toEqual(planAbandonOffer(["kxyz"]))
    expect(e.after).toEqual({ kind: "remove" })
  })

  test("forget removes the record and runs nothing; withdraw with no offer left only removes it", () => {
    const removes = {
      writes: [],
      steps: [],
      after: { kind: "remove" },
      built: false,
    }
    expect(planOfferEffects("forget", context(null))).toEqual(removes)
    expect(planOfferEffects("withdraw", context(null))).toEqual(removes)
  })

  test("an archived thread has no place: withdraw still abandons its offer, and nothing else acts", () => {
    const archived = { ...context(offer()), place: null, base: null }
    expect(planOfferEffects("withdraw", archived).steps).toEqual(
      planAbandonOffer(["kxyz"]),
    )
    for (const plan of ["build", "follow", "refresh", "none"] as const)
      expect(planOfferEffects(plan, archived)).toEqual({
        writes: [],
        steps: [],
        after: { kind: "nothing" },
        built: false,
      })
  })

  test("the lane's base record is written first when it changed, whatever the plan; never when it did not", () => {
    const moved = {
      next: { ...BASE_RECORD, start: NEW_TIP },
      stored: BASE_RECORD,
    }
    for (const plan of ["none", "build", "follow", "withdraw"] as const) {
      expect(
        planOfferEffects(plan, { ...context(offer()), base: moved }).writes,
      ).toEqual(setIfChanged(BASE, moved.next, moved.stored))
      expect(planOfferEffects(plan, context(offer())).writes).toEqual([])
    }
    expect(setIfChanged(BASE, moved.next, moved.stored)).toHaveLength(1)
  })

  test("repair names a divergent offer's change ids", () => {
    expect(
      planOfferEffects(
        "repair",
        context({ kind: "divergent", changes: ["ka", "kb"] }),
      ).after,
    ).toEqual({ kind: "repair", changes: ["ka", "kb"] })
  })

  test("build names the lane's tip as its one source, with the WIP line", () => {
    expect(planOfferEffects("build", context(null))).toEqual({
      writes: [],
      steps: [],
      after: {
        kind: "build",
        sources: [{ commit: NEW_TIP, description: "WIP (amber-fox): fix it" }],
      },
      built: true,
    })
  })
})

describe("planTake (ADR-0060)", () => {
  const o = offer({
    revisions: [
      { commit: commitId("b1"), change: "kbot", since: NOT_YOURS },
      { commit: commitId("b2"), change: "ktop", since: NOT_YOURS },
    ],
  })
  const r = offerRecord({
    lane: LANE,
    name: NAME,
    offer: o,
    place: { tip: TIP, start: [START] },
    editing: new Set(),
    now: 1,
  })
  const wip = {
    bookmark: "wip/x",
    kind: "wip",
    bringsAlong: 0,
    final: false,
  } as const
  const line = {
    bookmark: "pineta-onto",
    kind: "line",
    bringsAlong: 2,
    final: true,
  } as const
  /** What the page drew: this offer's ledger, not conflicting. */
  const SHOWN = { ledger: o.ledger, conflicted: false }
  const take = (
    to: string | null,
    below = (_: string) => true,
    base: BaseNow = UNCHANGED,
    now: { offer?: typeof o; seen?: OfferSeen } = {},
  ) =>
    planTake({
      base,
      seen: now.seen ?? SHOWN,
      offer: now.offer ?? o,
      record: r,
      destinations: [wip, line],
      to,
      below,
      now: 9,
    })
  test("the default destination moves forward to the top, and the offer is marked taken", () => {
    expect(take(null)).toEqual({
      kind: "take",
      writes: [],
      steps: planTakeOffer({
        bookmark: r.bookmark,
        top: "ktop",
        destination: "wip/x",
      }),
      taken: { ...r, taken: "ktop", at: 9 },
    })
  })
  test("a take writes the lane's base record when it changed", () => {
    const moved = {
      next: { ...BASE_RECORD, state: "landed" as const },
      stored: BASE_RECORD,
    }
    const planned = take(null, () => true, moved)
    expect(planned.kind === "take" && planned.writes).toEqual(
      setIfChanged(BASE, moved.next, moved.stored),
    )
  })
  test.each([
    [
      "rebased onto a moved target, the same ledger",
      {
        offer: offer({
          ...o,
          revisions: [
            { commit: commitId("c9"), change: "ktop", since: NOT_YOURS },
          ],
        }),
      },
      "take",
    ],
    [
      "edited by you, the same ledger",
      {
        offer: offer({
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
      "take",
    ],
    [
      "another ledger: the lane moved on",
      { offer: offer({ ...o, ledger: { source: NEW_TIP, start: [START] } }) },
      ERR.OFFER_CHANGED,
    ],
    [
      "another start, the same source",
      {
        offer: offer({
          ...o,
          ledger: { source: TIP, start: [START, NEW_TIP] },
        }),
      },
      ERR.OFFER_CHANGED,
    ],
    [
      "the same start, in another order",
      {
        offer: offer({
          ...o,
          ledger: { source: TIP, start: [NEW_TIP, START] },
        }),
        seen: {
          ledger: { source: TIP, start: [START, NEW_TIP] },
          conflicted: false,
        },
      },
      "take",
    ],
    [
      "newly conflicting",
      { offer: offer({ ...o, conflicts: ["a.txt"] }) },
      ERR.OFFER_CHANGED,
    ],
    [
      "conflicting, as it was shown",
      {
        offer: offer({ ...o, conflicts: ["a.txt"] }),
        seen: { ledger: o.ledger, conflicted: true },
      },
      "take",
    ],
    [
      "shown no ledger, now one",
      { seen: { ledger: null, conflicted: false } },
      ERR.OFFER_CHANGED,
    ],
  ] as const)("a take of the offer it was shown: %s", (_, now, outcome) => {
    const planned = take(null, () => true, UNCHANGED, now)
    expect(planned.kind === "take" ? "take" : planned.code).toBe(outcome)
  })
  test("a named destination among the offer's is taken there", () => {
    const planned = take("pineta-onto")
    expect(
      planned.kind === "take" && planned.steps[0]?.args.join(" "),
    ).toContain("bookmark move pineta-onto --to ktop")
  })
  test("a destination not among the offer's, or not below it, is refused", () => {
    expect(take("main")).toEqual({ kind: "refused", code: ERR.BAD_DESTINATION })
    expect(take(null, () => false)).toEqual({
      kind: "refused",
      code: ERR.BAD_DESTINATION,
    })
  })
})

describe("the line (ADR-0060)", () => {
  const facts = {
    commit: null,
    heads: "trunk()",
    log: null,
    wips: [],
    yours: {
      behind: 0,
      ahead: null,
      follow: null,
      conflicts: { commits: 0, files: [] },
    },
  } as const
  const record = (over: Partial<LineRecord> = {}): LineRecord => ({
    ...planLineRecord(facts, DEFAULT_LINE, true),
    ...over,
  })
  test("planLineRecord proposes your heads with the line's added", () => {
    expect(record().heads).toEqual({
      current: "trunk()",
      proposed: immutableHeads(DEFAULT_LINE, "trunk()"),
    })
    expect(record().log).toEqual({ current: null, proposed: logRevset(null) })
  })
  test("setup writes the bookmark at your @- and exactly the proposed heads and log", () => {
    expect(planLineAction("setup", record())).toEqual({
      kind: "steps",
      steps: planLineSetup({
        onto: "pineta-onto",
        heads: immutableHeads(DEFAULT_LINE, "trunk()"),
        log: logRevset(null),
      }),
    })
  })
  test("a host that admits others refuses both; a set line refuses setup", () => {
    expect(planLineAction("setup", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(planLineAction("land", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(
      planLineAction("setup", record({ commit: commitId("c1") })).kind,
    ).toBe("refused")
  })
  test("land: only with a line, and your work above it", () => {
    expect(planLineAction("land", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    const set = (ahead: number | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 0,
          ahead,
          follow: null,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("land", set(null)).kind).toBe("refused")
    expect(planLineAction("land", set(0)).kind).toBe("refused")
    expect(planLineAction("land", set(2))).toEqual({
      kind: "steps",
      steps: planLand({ onto: "pineta-onto" }),
    })
  })
  test("follow: only with a line and a preview, the one you were shown; a conflict in it refuses nothing", () => {
    const preview = { files: ["a.txt"], conflicts: ["a.txt"], heads: 0 }
    const set = (follow: typeof preview | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 2,
          ahead: 1,
          follow,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("follow", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    expect(planLineAction("follow", set(null))).toEqual({
      kind: "refused",
      code: ERR.REFUSED,
    })
    expect(planLineAction("follow", set(preview))).toEqual({
      kind: "steps",
      steps: planFollow({ onto: "pineta-onto" }),
    })
    expect(
      planLineAction("follow", { ...set(preview), commands: false }),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
  })
})

describe("planMarks: what a move the owner observed refreshes", () => {
  const A = laneNameForThread("a")
  const B = laneNameForThread("b")
  const C = laneNameForThread("c")
  const names = new Map([
    [A, "amber-fox" as ThreadName],
    [B, "brave-owl" as ThreadName],
  ])
  const moved = (over: Partial<Moved> = {}): Moved => ({
    all: false,
    yours: false,
    lanes: new Set(),
    offers: new Set(),
    ...over,
  })
  const marks = (m: Moved, open: readonly LaneName[] = [C]) =>
    planMarks({ moved: m, names, open })
  test("everything moved marks the line, every named lane and every open record", () => {
    expect(marks(moved({ all: true, yours: true }))).toEqual({
      line: true,
      shared: false,
      lanes: [A, B, C],
    })
  })
  test("your @ alone marks no lane: one shared read rewrites your edits and the line's record", () => {
    expect(marks(moved({ yours: true }))).toEqual({
      line: false,
      shared: true,
      lanes: [],
    })
  })
  test("a lane's ref marks that lane alone, and not the line", () => {
    expect(marks(moved({ lanes: new Set([B]) }))).toEqual({
      line: false,
      shared: false,
      lanes: [B],
    })
  })
  test("an offer bookmark marks the lane its thread names; an unknown name marks none", () => {
    expect(
      marks(
        moved({
          offers: new Set(["amber-fox", "nobody-here"] as ThreadName[]),
        }),
      ),
    ).toEqual({ line: false, shared: false, lanes: [A] })
  })
  test("nothing moved marks nothing", () => {
    expect(marks(moved())).toEqual({ line: false, shared: false, lanes: [] })
  })
})
