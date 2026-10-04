import {
  commitId,
  laneNameForThread,
  type OfferNow,
  offerMessage,
  type Placed,
  type RefreshDecision,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  describeEffects,
  offerEffects,
  offerIntegrationEffects,
  rebuildEffects,
} from "./offer-steps.ts"
import {
  planAbandonOffer,
  planDescribe,
  planFollowOffer,
  planOffer,
  planOfferIntegrationSteps,
  planRefreshOffer,
} from "./plan.ts"

const LANE = laneNameForThread("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const NEW_TIP = commitId("22222222")
const START = commitId("33333333")
const TARGET = commitId("44444444")
const NOT_YOURS = { reached: true, yoursChanged: false }
const OFFER: OfferNow = {
  kind: "offer",
  bookmark: `pineta-offer/${NAME}`,
  revisions: [
    { commit: commitId("55555555"), change: "kxyz", since: NOT_YOURS },
  ],
  chained: true,
  ledger: { source: TIP, start: [START] },
  firstLine: `WIP (${NAME}): fix it`,
  placed: true,
  onTarget: true,
  files: ["a.txt"],
  conflicts: [],
  startConflicts: [],
}
const PLACE: Placed = {
  kind: "placed",
  tip: NEW_TIP,
  base: { base: { kind: "line" }, start: START, source: START },
  state: "ok",
  target: TARGET,
  start: [START],
}
const TRAILERS = { lane: LANE, name: NAME, entry: "e1" }
const AT = { ...TRAILERS, wip: "WIP (amber-fox): fix it", nonce: "n1" }
const LEDGER = { source: NEW_TIP, start: [START] }

describe("offerEffects: each refresh decision's steps, and what follows", () => {
  test("follow: planFollowOffer's steps, its WIP line with the host's trailers and the new ledger, then a record", () => {
    const e = offerEffects({ kind: "follow", place: PLACE, offer: OFFER }, AT)
    expect(e).toEqual({
      steps: planFollowOffer({
        change: "kxyz",
        start: [START],
        tip: NEW_TIP,
        target: TARGET,
        description: offerMessage(AT.wip, { ...TRAILERS, ledger: LEDGER }),
      }),
      after: { kind: "record", place: PLACE },
      built: true,
    })
  })
  test("none, stale and leave run nothing and record: the read made before planning is still the offer", () => {
    for (const kind of ["none", "stale", "leave"] as const)
      expect(offerEffects({ kind, place: PLACE }, AT)).toEqual({
        steps: [],
        after: { kind: "record", place: PLACE },
        built: false,
      })
  })
  test("withdraw plans the abandon, then the record's removal; forget only removes it", () => {
    expect(offerEffects({ kind: "withdraw", offer: OFFER }, AT)).toEqual({
      steps: planAbandonOffer(["kxyz"]),
      after: { kind: "remove" },
      built: false,
    })
    expect(offerEffects({ kind: "forget" }, AT)).toEqual({
      steps: [],
      after: { kind: "remove" },
      built: false,
    })
  })
  test("refresh rebases the bottom onto the target; repair names the changes; untouched does nothing", () => {
    expect(
      offerEffects({ kind: "refresh", place: PLACE, offer: OFFER }, AT).steps,
    ).toEqual(planRefreshOffer("kxyz", TARGET))
    expect(
      offerEffects({ kind: "repair", place: PLACE, changes: ["ka", "kb"] }, AT)
        .after,
    ).toEqual({ kind: "repair", place: PLACE, changes: ["ka", "kb"] })
    expect(offerEffects({ kind: "untouched" }, AT)).toEqual({
      steps: [],
      after: { kind: "nothing" },
      built: false,
    })
  })
  test("build names the lane's tip as its one source on its WIP line, and is a rebuild with nothing to abandon", () => {
    const build = offerEffects({ kind: "build", place: PLACE }, AT)
    expect(build).toEqual({
      steps: planOffer({
        name: NAME,
        start: [START],
        sources: [
          {
            commit: NEW_TIP,
            description: offerMessage(AT.wip, { ...TRAILERS, ledger: LEDGER }),
          },
        ],
        target: TARGET,
        nonce: "n1",
      }),
      after: { kind: "record", place: PLACE },
      built: true,
    })
    expect(
      rebuildEffects(
        {
          name: NAME,
          place: PLACE,
          changes: [],
          sources: [{ commit: NEW_TIP, description: AT.wip }],
        },
        AT,
      ),
    ).toEqual(build)
  })
  test("each decision's after carries its place", () => {
    const decisions: RefreshDecision[] = [
      { kind: "build", place: PLACE },
      { kind: "follow", place: PLACE, offer: OFFER },
      { kind: "refresh", place: PLACE, offer: OFFER },
      { kind: "none", place: PLACE },
      { kind: "repair", place: PLACE, changes: ["k"] },
    ]
    for (const d of decisions) {
      const { after } = offerEffects(d, AT)
      expect("place" in after && after.place).toBe(PLACE)
    }
  })
})

test("rebuildEffects: the old revisions abandoned, then each source on the start, with the place's ledger", () => {
  const e = rebuildEffects(
    {
      name: NAME,
      place: PLACE,
      changes: ["ka", "kb"],
      sources: [{ commit: commitId("r1"), description: "first" }],
    },
    { ...TRAILERS, nonce: "n2" },
  )
  expect(e.steps).toEqual([
    ...planAbandonOffer(["ka", "kb"]),
    ...planOffer({
      name: NAME,
      start: [START],
      sources: [
        {
          commit: commitId("r1"),
          description: offerMessage("first", { ...TRAILERS, ledger: LEDGER }),
        },
      ],
      target: TARGET,
      nonce: "n2",
    }),
  ])
})

test("offerIntegrationEffects and describeEffects: the integration's bookmark move, and the message with the offer's ledger", () => {
  const integrated = {
    lane: LANE,
    size: 1,
    stale: false,
    files: [],
    conflicts: [],
    startConflicts: [],
    yourEdits: [],
    described: false,
    edited: false,
    bookmark: `pineta-offer/${NAME}`,
    integratedAs: "ktop",
    commits: [],
    ledger: null,
    at: 1,
  }
  expect(
    offerIntegrationEffects({
      kind: "integrate",
      name: NAME,
      bookmark: integrated.bookmark,
      destination: "pineta-onto",
      top: "ktop",
      integrated,
    }),
  ).toEqual({
    steps: planOfferIntegrationSteps({
      bookmark: integrated.bookmark,
      top: "ktop",
      destination: "pineta-onto",
    }),
    after: { kind: "integrated", record: integrated },
    built: false,
  })
  const ledger = { source: TIP, start: [START] }
  expect(
    describeEffects(
      { name: NAME, place: PLACE, change: "kxyz", ledger },
      "fix: it",
      TRAILERS,
    ),
  ).toEqual({
    steps: planDescribe(
      "kxyz",
      offerMessage("fix: it", { ...TRAILERS, ledger }),
    ),
    after: { kind: "record", place: PLACE },
    built: false,
  })
})
