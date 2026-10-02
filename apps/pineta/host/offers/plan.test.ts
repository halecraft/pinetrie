import {
  commitId,
  ERR,
  type LineRecord,
  laneNameForThread,
  type OfferRecord,
} from "@pineta/core"
import {
  DEFAULT_LINE,
  immutableHeads,
  logRevset,
  planAbandonOffer,
  planFollowOffer,
  planLand,
  planLineSetup,
  planTakeOffer,
} from "@pineta/lanes"
import { describe, expect, test } from "vitest"
import {
  builtOf,
  type OfferAt,
  offerRecord,
  planLineAction,
  planLineRecord,
  planOfferEffects,
  planTake,
  type RefreshContext,
  readBaseline,
} from "./plan.ts"

const LANE = laneNameForThread("0123456789abcdef")
const TIP = commitId("11111111")
const NEW_TIP = commitId("22222222")
const START = commitId("33333333")
const WROTE = commitId("44444444")
const NOW_COMMIT = commitId("55555555")

const offer = (overrides: Partial<OfferRecord> = {}): OfferRecord => ({
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt"],
  conflicts: [],
  yourEdits: [],
  described: false,
  edited: false,
  bookmark: "pineta-offer/amber-fox",
  taken: null,
  commits: [WROTE],
  at: 1,
  host: { changes: ["kxyz"], wrote: [WROTE], tip: TIP, start: [START] },
  ...overrides,
})

const context = (open: OfferRecord | null): RefreshContext => ({
  root: "/repo",
  tip: NEW_TIP,
  start: [START],
  target: "@-",
  wip: "WIP (amber fox): fix it",
  open,
  live: true,
  read: [NOW_COMMIT],
})

describe("offerRecord", () => {
  test("names each revision's commit as it is now, and keeps what the host wrote", () => {
    const at: OfferAt = {
      bookmark: "pineta-offer/amber-fox",
      tip: TIP,
      start: [START],
      commits: [WROTE],
      changes: ["kxyz"],
      target: "@-",
      stale: false,
      described: true,
      edited: false,
    }
    const r = offerRecord(
      LANE,
      at,
      { files: ["a.txt"], conflicts: [], commits: [NOW_COMMIT] },
      ["a.txt"],
      7,
    )
    expect(r.commits).toEqual([NOW_COMMIT])
    expect(r.host).toEqual({
      changes: ["kxyz"],
      wrote: [WROTE],
      tip: TIP,
      start: [START],
    })
    expect([r.size, r.yourEdits, r.at, r.taken]).toEqual([
      1,
      ["a.txt"],
      7,
      null,
    ])
  })
})

describe("planOfferEffects", () => {
  test("follow plans planFollowOffer's steps, then a record read after them; never a build", () => {
    const e = planOfferEffects("follow", context(offer()))
    expect(e.steps).toEqual(
      planFollowOffer({
        root: "/repo",
        change: "kxyz",
        start: [START],
        tip: NEW_TIP,
        target: "@-",
        description: "WIP (amber fox): fix it",
      }),
    )
    expect(e.after).toMatchObject({
      kind: "record",
      reread: offer(),
      at: { tip: NEW_TIP, described: false },
    })
    expect(e.built).toBe(true)
  })

  test("an offer that follows is a work in progress again, its ledger the new tip (ADR-0060)", () => {
    const steps = (described: boolean) =>
      planOfferEffects("follow", context(offer({ described }))).steps
    expect(steps(false)).toEqual(steps(true))
    expect(steps(true).at(-1)?.argv).toContain("WIP (amber fox): fix it")
  })

  test("withdraw plans the abandon, then the record's removal", () => {
    const e = planOfferEffects("withdraw", context(offer()))
    expect(e.steps).toEqual(planAbandonOffer("/repo", ["kxyz"]))
    expect(e.after).toEqual({ kind: "remove" })
  })

  test("an offer not yours takes what was read as its baseline; one you edited keeps what the host wrote", () => {
    const wroteOf = (plan: "none" | "stale" | "leave") => {
      const e = planOfferEffects(plan, context(offer()))
      return e.after.kind === "record" ? e.after.at.commits : null
    }
    expect(wroteOf("none")).toEqual([NOW_COMMIT])
    expect(wroteOf("stale")).toEqual([NOW_COMMIT])
    expect(wroteOf("leave")).toEqual([WROTE])
  })

  test("build names the lane's tip as its one source, with the WIP line", () => {
    expect(planOfferEffects("build", context(null))).toEqual({
      steps: [],
      after: {
        kind: "build",
        sources: [{ commit: NEW_TIP, description: "WIP (amber fox): fix it" }],
      },
      built: true,
    })
  })
})

describe("planTake (ADR-0060)", () => {
  const o = offer({
    host: {
      changes: ["kbot", "ktop"],
      wrote: [WROTE, WROTE],
      tip: TIP,
      start: [START],
    },
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
        bookmark: o.bookmark,
        top: "ktop",
        destination: "wip/x",
      }),
      taken: { ...o, taken: "ktop", at: 9 },
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
    yours: { behind: 0, ahead: null },
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
      record({ commit: commitId("c1"), yours: { behind: 0, ahead } })
    expect(planLineAction("land", set(null), "/repo").kind).toBe("refused")
    expect(planLineAction("land", set(0), "/repo").kind).toBe("refused")
    expect(planLineAction("land", set(2), "/repo")).toEqual({
      kind: "steps",
      steps: planLand({ root: "/repo", onto: "pineta-onto" }),
    })
  })
})

describe("readBaseline: what a refresh takes as your edits' baseline (S73)", () => {
  const same = { sameDescription: true, sameChange: true, since: null }
  const commits = [commitId("now")]
  test("a revision jj only rebased keeps the host's write", () => {
    expect(readBaseline({ commits, revisions: [same] })).toBeNull()
  })
  test("one that differs, as the host's own lost write, is read now", () => {
    expect(
      readBaseline({
        commits,
        revisions: [
          same,
          {
            sameDescription: true,
            sameChange: false,
            since: { reached: true, yoursChanged: false },
          },
        ],
      }),
    ).toEqual(commits)
  })
})

describe("builtOf: what an offer was built from and on (ADR-0060)", () => {
  test("its message's ledger, over the record's copy", () => {
    const ledger = { source: commitId("src"), start: [commitId("st")] }
    expect(builtOf(ledger, offer())).toEqual({
      builtFrom: ledger.source,
      builtOn: ledger.start,
    })
  })
  test("the record's copy when you rewrote the message without it", () => {
    const o = offer()
    expect(builtOf(null, o)).toEqual({
      builtFrom: o.host.tip,
      builtOn: o.host.start,
    })
  })
})
