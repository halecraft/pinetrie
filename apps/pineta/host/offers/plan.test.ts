import { commitId, laneNameForThread, type OfferRecord } from "@pineta/core"
import { planAbandonOffer, planFollowOffer, planTakeOffer } from "@pineta/lanes"
import { describe, expect, test } from "vitest"
import {
  type OfferAt,
  offerRecord,
  planOfferEffects,
  planTake,
  type RefreshContext,
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
        description: null,
      }),
    )
    expect(e.after).toMatchObject({
      kind: "record",
      reread: offer(),
      at: { tip: NEW_TIP, described: false },
    })
    expect(e.built).toBe(true)
  })

  test("a described offer that follows is a work in progress again; an undescribed one keeps its line", () => {
    const steps = (described: boolean) =>
      planOfferEffects("follow", context(offer({ described }))).steps
    expect(steps(true)).toEqual(
      planFollowOffer({
        root: "/repo",
        change: "kxyz",
        start: [START],
        tip: NEW_TIP,
        target: "@-",
        description: "WIP (amber fox): fix it",
      }),
    )
    expect(steps(false)).not.toEqual(steps(true))
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

describe("planTake", () => {
  test("its steps are planTakeOffer's; it delivers the offer's tip as a have, and marks the offer taken as its top", () => {
    const o = offer({
      host: {
        changes: ["kbot", "ktop"],
        wrote: [WROTE, WROTE],
        tip: TIP,
        start: [START],
      },
    })
    const planned = planTake({
      root: "/repo",
      lane: LANE,
      offer: o,
      target: "@-",
      underYou: true,
      now: 9,
    })
    expect(planned?.steps).toEqual(
      planTakeOffer({
        root: "/repo",
        bookmark: o.bookmark,
        bottom: "kbot",
        top: "ktop",
        target: "@-",
        underYou: true,
        onto: false,
      }),
    )
    expect(planned?.have).toEqual({
      lane: LANE,
      commit: TIP,
      kind: "delivered",
      at: 9,
    })
    expect(planned?.taken).toMatchObject({ taken: "ktop", at: 9 })
  })
})
