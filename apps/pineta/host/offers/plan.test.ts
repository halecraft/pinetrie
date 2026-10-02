import {
  commitId,
  ERR,
  type LineRecord,
  laneNameForThread,
  type OfferInRepo,
  type ThreadName,
} from "@pineta/core"
import {
  DEFAULT_LINE,
  immutableHeads,
  logRevset,
  planAbandonOffer,
  planFollow,
  planFollowOffer,
  planLand,
  planLineSetup,
  planTakeOffer,
} from "@pineta/lanes"
import { offerMessage } from "@pineta/marginalia"
import { describe, expect, test } from "vitest"
import {
  offerRecord,
  planLineAction,
  planLineRecord,
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
const context = (read: OfferInRepo | null): RefreshContext => ({
  root: "/repo",
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
      yourEdits: ["a.txt"],
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
      at: 7,
    })
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
        root: "/repo",
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
        steps: [],
        after: { kind: "record" },
        built: false,
      })
  })

  test("withdraw plans the abandon, then the record's removal", () => {
    const e = planOfferEffects("withdraw", context(offer()))
    expect(e.steps).toEqual(planAbandonOffer("/repo", ["kxyz"]))
    expect(e.after).toEqual({ kind: "remove" })
  })

  test("forget removes the record and runs nothing; withdraw with no offer left only removes it", () => {
    const removes = { steps: [], after: { kind: "remove" }, built: false }
    expect(planOfferEffects("forget", context(null))).toEqual(removes)
    expect(planOfferEffects("withdraw", context(null))).toEqual(removes)
  })

  test("an archived thread has no place: withdraw still abandons its offer, and nothing else acts", () => {
    const archived = { ...context(offer()), place: null }
    expect(planOfferEffects("withdraw", archived).steps).toEqual(
      planAbandonOffer("/repo", ["kxyz"]),
    )
    for (const plan of ["build", "follow", "refresh", "none"] as const)
      expect(planOfferEffects(plan, archived)).toEqual({
        steps: [],
        after: { kind: "nothing" },
        built: false,
      })
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
    yourEdits: [],
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
  const take = (to: string | null, below = (_: string) => true) =>
    planTake({
      root: "/repo",
      offer: o,
      record: r,
      destinations: [wip, line],
      to,
      below,
      now: 9,
    })
  test("the default destination moves forward to the top, and the offer is marked taken", () => {
    expect(take(null)).toEqual({
      kind: "take",
      steps: planTakeOffer({
        root: "/repo",
        bookmark: r.bookmark,
        top: "ktop",
        destination: "wip/x",
      }),
      taken: { ...r, taken: "ktop", at: 9 },
    })
  })
  test("a named destination among the offer's is taken there", () => {
    const planned = take("pineta-onto")
    expect(
      planned.kind === "take" && planned.steps[0]?.argv.join(" "),
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
    expect(planLineAction("setup", record(), "/repo")).toEqual({
      kind: "steps",
      steps: planLineSetup({
        root: "/repo",
        onto: "pineta-onto",
        heads: immutableHeads(DEFAULT_LINE, "trunk()"),
        log: logRevset(null),
      }),
    })
  })
  test("a host that admits others refuses both; a set line refuses setup", () => {
    expect(
      planLineAction("setup", record({ commands: false }), "/repo"),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
    expect(
      planLineAction("land", record({ commands: false }), "/repo"),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
    expect(
      planLineAction("setup", record({ commit: commitId("c1") }), "/repo").kind,
    ).toBe("refused")
  })
  test("land: only with a line, and your work above it", () => {
    expect(planLineAction("land", record(), "/repo")).toEqual({
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
    expect(planLineAction("land", set(null), "/repo").kind).toBe("refused")
    expect(planLineAction("land", set(0), "/repo").kind).toBe("refused")
    expect(planLineAction("land", set(2), "/repo")).toEqual({
      kind: "steps",
      steps: planLand({ root: "/repo", onto: "pineta-onto" }),
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
    expect(planLineAction("follow", record(), "/repo")).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    expect(planLineAction("follow", set(null), "/repo")).toEqual({
      kind: "refused",
      code: ERR.REFUSED,
    })
    expect(planLineAction("follow", set(preview), "/repo")).toEqual({
      kind: "steps",
      steps: planFollow({ root: "/repo", onto: "pineta-onto" }),
    })
    expect(
      planLineAction("follow", { ...set(preview), commands: false }, "/repo"),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
  })
})
