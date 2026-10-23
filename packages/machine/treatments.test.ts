import { type ThreadId, threadIdFor } from "@pinetrie/core"
import fc from "fast-check"
import { describe, expect, test } from "vitest"
import type { Rung } from "./rung.ts"
import {
  FIRST_TREATMENT_STATE,
  heldForRepair,
  isActivityAllowed,
  type LaneToTreat,
  planTreatments,
  type TreatmentPlanState,
} from "./treatments.ts"

const GiB = 1024 ** 3
const lanes = Array.from({ length: 6 }, (_, i) => threadIdFor(`t-${i}`))
const [a, b, c, d] = lanes as [ThreadId, ThreadId, ThreadId, ThreadId]

const running = (
  lane: ThreadId,
  programInFlight: string | null = null,
): LaneToTreat => ({
  lane,
  memory: {
    current: GiB,
    anon: GiB / 4,
    file: GiB / 2,
    limit: null,
    oomKills: 0,
    pressure: null,
  },
  programInFlight,
})
const unread = (lane: ThreadId): LaneToTreat => ({
  lane,
  memory: null,
  programInFlight: null,
})

type Input = Parameters<typeof planTreatments>[1]

/** Each input planned in turn from the first state; every plan. */
function plans(inputs: readonly Input[]) {
  let state: TreatmentPlanState = FIRST_TREATMENT_STATE
  return inputs.map(input => {
    const planned = planTreatments(state, input)
    state = planned.state
    return planned
  })
}
const at = (rung: Rung, more: Partial<Input> = {}): Input => ({
  rung,
  lanesRunning: [],
  lanesWaitingToStart: [],
  lanesByImportance: lanes,
  ...more,
})

const RUNGS = fc.constantFrom<Rung>(0, 1, 2, 3, 4, 5)
const LANES = fc.subarray(lanes)
const INPUT = fc.record({
  rung: RUNGS,
  lanesRunning: LANES.map(ls => ls.map(l => running(l))),
  lanesWaitingToStart: LANES,
  lanesByImportance: fc.shuffledSubarray(lanes, { minLength: lanes.length }),
})

describe("planTreatments", () => {
  test("every lane has a treatment, and one not running is waiting-to-start from rung 2", () => {
    fc.assert(
      fc.property(INPUT, input => {
        const { treatments } = planTreatments(FIRST_TREATMENT_STATE, input)
        const runningLanes = new Set(input.lanesRunning.map(l => l.lane))
        for (const lane of lanes) {
          const kind = treatments.laneTreatment(lane).kind
          if (runningLanes.has(lane)) expect(kind).not.toBe("waiting-to-start")
          else if (input.rung >= 2) expect(kind).toBe("waiting-to-start")
        }
      }),
    )
  })

  test("no lane is held below rung 2 with nothing held before", () => {
    fc.assert(
      fc.property(
        INPUT.filter(i => i.rung < 2),
        input => {
          const { treatments } = planTreatments(FIRST_TREATMENT_STATE, input)
          for (const lane of lanes)
            expect(treatments.laneTreatment(lane).kind).toBe("normal")
          expect(treatments.held).toEqual([])
        },
      ),
    )
  })

  test("as the rung falls, held starts are let go one a sample, most important first", () => {
    const waiting = { lanesWaitingToStart: [c, a, b] }
    const got = plans([
      at(2, waiting),
      at(1, waiting),
      at(1, { lanesWaitingToStart: [c, b] }),
      at(0, { lanesWaitingToStart: [c] }),
      at(0),
    ])
    const normal = (i: number) =>
      [a, b, c].filter(
        l => got[i]?.treatments.laneTreatment(l).kind === "normal",
      )
    expect(normal(0)).toEqual([])
    expect(normal(1)).toEqual([a])
    expect(normal(2)).toEqual([a, b])
    expect(normal(3)).toEqual([a, b, c])
    expect(got[4]?.state.startsHeld).toEqual([])
  })

  test("a lane let go is normal until a sample lists it running", () => {
    const got = plans([
      at(2, { lanesWaitingToStart: [a] }),
      at(1, { lanesWaitingToStart: [a] }),
      at(2),
      at(2, { lanesRunning: [running(a)] }),
      at(2),
    ])
    expect(got[2]?.treatments.laneTreatment(a).kind).toBe("normal")
    expect(got[3]?.treatments.laneTreatment(a).kind).toBe("normal")
    expect(got[4]?.treatments.laneTreatment(a).kind).toBe("waiting-to-start")
  })

  test("at rung 3 the most important lanes are never paused, their count falling while it holds, never below 1, and rising below it", () => {
    const four = { lanesRunning: [d, c, b, a].map(l => running(l)) }
    const got = plans([
      at(3, four),
      at(3, four),
      at(3, four),
      at(3, four),
      at(3, four),
      at(2, four),
      at(2, four),
      at(2, four),
    ])
    const allowed = got.map(p => p.state.lanesAllowedToCall)
    expect(allowed).toEqual([4, 3, 2, 1, 1, 2, 3, null])
    const paused = (i: number) =>
      lanes.filter(l => got[i]?.treatments.laneTreatment(l).kind === "paused")
    expect(paused(0)).toEqual([])
    expect(paused(2)).toEqual([c, d])
    expect(paused(4)).toEqual([b, c, d])
    expect(paused(7)).toEqual([])
  })

  test("a running lane with no cgroup read is never held for being unseen", () => {
    const got = plans([at(2, { lanesRunning: [unread(a)] })])
    expect(got[0]?.treatments.laneTreatment(a).kind).toBe("normal")
    expect(got[0]?.shadowDecisions).toEqual([])
  })

  test("shadow decisions: a squeeze from rung 1, a freeze from rung 4, a kill at rung 5, none at rung 0", () => {
    fc.assert(
      fc.property(RUNGS, fc.subarray(lanes, { minLength: 2 }), (rung, ls) => {
        const [busy, ...idle] = ls as [ThreadId, ...ThreadId[]]
        const input = at(rung, {
          lanesRunning: [running(busy, "pnpm"), ...idle.map(l => running(l))],
        })
        // A sample at rung 3 first, so some lanes are paused at 4 and 5.
        const state =
          rung >= 4
            ? planTreatments(FIRST_TREATMENT_STATE, { ...input, rung: 3 }).state
            : FIRST_TREATMENT_STATE
        const kinds = new Set(
          planTreatments(state, input).shadowDecisions.map(s => s.kind),
        )
        expect(kinds.has("squeeze")).toBe(rung >= 1)
        expect(kinds.has("freeze")).toBe(rung >= 4)
        expect(kinds.has("kill")).toBe(rung === 5)
      }),
    )
  })

  test("planning twice from the same input gives the same value", () => {
    fc.assert(
      fc.property(INPUT, input => {
        const once = planTreatments(FIRST_TREATMENT_STATE, input)
        const twice = planTreatments(FIRST_TREATMENT_STATE, input)
        expect(twice.state).toEqual(once.state)
        expect(twice.shadowDecisions).toEqual(once.shadowDecisions)
        expect(twice.treatments.held).toEqual(once.treatments.held)
      }),
    )
  })
})

test("while a repair runs, every lane waits, those listed and any unseen, for anything", () => {
  const held = heldForRepair([lanes[0] ?? threadIdFor("x")])
  expect(held.held).toEqual([
    { lane: lanes[0], treatment: { kind: "waiting-for-repair" } },
  ])
  for (const lane of [lanes[0], lanes[5]].map(l => l ?? threadIdFor("x")))
    for (const activity of ["tool-call", "container-start"] as const)
      expect(isActivityAllowed(held.laneTreatment(lane), activity)).toBe(false)
})
