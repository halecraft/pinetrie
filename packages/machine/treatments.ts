// machine/treatments — what each lane may do while memory is short, planned
// afresh each sample from the rung. A hold is a treatment, read by whoever
// would act: nothing is released by hand, so no release can be forgotten.
// Rungs 1, 4 and 5 are planned as decisions not taken (`ShadowDecision`):
// what squeezing, freezing and killing would have done, measured before any
// is built.

import type {
  CgroupMemory,
  HeldLane,
  LaneTreatment,
  ThreadId,
} from "@pinetrie/core"
import type { Rung } from "./rung.ts"

export type LaneActivity = "tool-call" | "container-start"

/** What each treatment lets a lane do: the one place it is said. */
export const ACTIVITIES_ALLOWED = {
  normal: ["tool-call", "container-start"],
  "waiting-to-start": [],
  paused: ["container-start"],
  "waiting-for-repair": [],
} as const satisfies Record<LaneTreatment["kind"], readonly LaneActivity[]>

/** Whether `treatment` lets a lane do `activity`. */
export function isActivityAllowed(
  treatment: LaneTreatment,
  activity: LaneActivity,
): boolean {
  const allowed: readonly LaneActivity[] = ACTIVITIES_ALLOWED[treatment.kind]
  return allowed.includes(activity)
}

/** What a rung not built would have done: measured, never done. */
export type ShadowDecision =
  | {
      readonly kind: "squeeze"
      readonly lane: ThreadId
      readonly wouldFreeBytes: number
    }
  | {
      readonly kind: "freeze"
      readonly lane: ThreadId
      readonly wouldFreeBytes: number
    }
  | {
      readonly kind: "kill"
      readonly lane: ThreadId
      readonly program: string
    }

/** A running lane container, its cgroup read or not. */
export interface LaneToTreat {
  readonly lane: ThreadId
  /** null where the backend reads no lane's cgroup. */
  readonly memory: CgroupMemory | null
  /** The program of the `bash` call it runs now; null between calls. */
  readonly programInFlight: string | null
}

export interface Treatments {
  /** Every lane's, a started one or not: the only way to read one. */
  laneTreatment(lane: ThreadId): LaneTreatment
  /** The lanes the plan knows to be held, for the record: every other is `normal` unless it asks to start. */
  readonly held: readonly HeldLane[]
}

export interface TreatmentPlanState {
  /** At rung 3 and after: how many running lanes may call. null while none is paused. */
  readonly lanesAllowedToCall: number | null
  /** Lanes held from starting, kept until each is let go: a release lets one go a sample. */
  readonly startsHeld: readonly ThreadId[]
  /** Lanes let go: `normal` until a sample lists them running, or they ask to start again. */
  readonly letGo: ReadonlySet<ThreadId>
}

export const FIRST_TREATMENT_STATE: TreatmentPlanState = {
  lanesAllowedToCall: null,
  startsHeld: [],
  letGo: new Set(),
}

const NORMAL: LaneTreatment = { kind: "normal" }
const WAITING_TO_START: LaneTreatment = { kind: "waiting-to-start" }
const PAUSED: LaneTreatment = { kind: "paused" }
const WAITING_FOR_REPAIR: LaneTreatment = { kind: "waiting-for-repair" }

/**
 * Every lane held while the lane VM's disk is repaired, any lane unseen
 * too: nothing it would do can reach a stopped VM. `lanes` are those
 * listed as held.
 */
export const heldForRepair = (lanes: readonly ThreadId[]): Treatments => ({
  laneTreatment: () => WAITING_FOR_REPAIR,
  held: lanes.map(lane => ({ lane, treatment: WAITING_FOR_REPAIR })),
})

/** Every lane `normal`: observing, or before the first plan. */
export const ALL_NORMAL: Treatments = {
  laneTreatment: () => NORMAL,
  held: [],
}

/**
 * Whether the lanes' order can decide anything at `rung`: who is paused,
 * which held start goes first, whom a shadow kill names. Below rung 2,
 * with no start held and none paused, it decides nothing, and need not be
 * gathered.
 */
export const isRankingNeeded = (
  state: TreatmentPlanState,
  rung: Rung,
): boolean =>
  rung >= 2 || state.startsHeld.length > 0 || state.lanesAllowedToCall !== null

/** `lanes` in `order`'s order, those it leaves out after, by id. */
function inOrder(
  lanes: readonly ThreadId[],
  order: readonly ThreadId[],
): ThreadId[] {
  const at = (l: ThreadId) => {
    const i = order.indexOf(l)
    return i < 0 ? order.length : i
  }
  return [...lanes].sort(
    (a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0),
  )
}

/**
 * Each lane's treatment after one sample, and the shadow decisions of the
 * rungs not built. From rung 2 a lane asking to start waits; below it, the
 * waiting are let go one a sample, most important first, so a release never
 * starts every held command at once. From rung 3 only the
 * `lanesAllowedToCall` most important running lanes make new calls: that
 * count starts at every running lane, falls by one each sample the rung
 * holds and rises by one each sample below it. Pausing frees nothing in
 * flight, so no estimate of what it frees enters the choice.
 */
export function planTreatments(
  state: TreatmentPlanState,
  input: {
    readonly rung: Rung
    readonly lanesRunning: readonly LaneToTreat[]
    readonly lanesWaitingToStart: readonly ThreadId[]
    readonly lanesByImportance: readonly ThreadId[]
  },
): {
  readonly treatments: Treatments
  readonly shadowDecisions: readonly ShadowDecision[]
  readonly state: TreatmentPlanState
} {
  const { rung, lanesRunning, lanesWaitingToStart, lanesByImportance } = input
  const running = new Set(lanesRunning.map(l => l.lane))
  const waiting = inOrder(
    lanesWaitingToStart.filter(l => !running.has(l)),
    lanesByImportance,
  )

  // Starts: held from rung 2, and while any held is left to let go.
  const stillHeld = state.startsHeld.filter(l => waiting.includes(l))
  const holding = rung >= 2 || stillHeld.length > 0
  const held = holding ? waiting : []
  const release = rung < 2 ? held.slice(0, 1) : []
  const startsHeld = held.filter(l => !release.includes(l))
  const letGo = new Set([
    ...[...state.letGo].filter(l => !running.has(l) && !waiting.includes(l)),
    ...release,
  ])

  // Calls: from rung 3, the most important running lanes only.
  const count = lanesRunning.length
  const allowed =
    rung >= 3
      ? state.lanesAllowedToCall === null
        ? count
        : Math.max(1, state.lanesAllowedToCall - 1)
      : state.lanesAllowedToCall === null ||
          state.lanesAllowedToCall + 1 >= count
        ? null
        : state.lanesAllowedToCall + 1
  const ranked = inOrder([...running], lanesByImportance)
  const paused = new Set(allowed === null ? [] : ranked.slice(allowed))

  const laneTreatment = (lane: ThreadId): LaneTreatment =>
    running.has(lane)
      ? paused.has(lane)
        ? PAUSED
        : NORMAL
      : letGo.has(lane)
        ? NORMAL
        : rung >= 2 || startsHeld.length > 0
          ? WAITING_TO_START
          : NORMAL

  // Rungs not built: only lanes whose memory was read are named.
  const measured = ranked.flatMap(lane => {
    const facts = lanesRunning.find(l => l.lane === lane)
    return facts?.memory == null ? [] : [{ ...facts, memory: facts.memory }]
  })
  const shadowDecisions: ShadowDecision[] = []
  for (const { lane, memory, programInFlight } of measured) {
    if (rung >= 1 && programInFlight === null)
      shadowDecisions.push({
        kind: "squeeze",
        lane,
        wouldFreeBytes: memory.file,
      })
    if (rung >= 4 && paused.has(lane))
      shadowDecisions.push({
        kind: "freeze",
        lane,
        wouldFreeBytes: memory.anon,
      })
  }
  const killed = measured.filter(l => l.programInFlight !== null).at(-1)
  if (rung >= 5 && killed?.programInFlight != null)
    shadowDecisions.push({
      kind: "kill",
      lane: killed.lane,
      program: killed.programInFlight,
    })

  return {
    treatments: {
      laneTreatment,
      held: [
        ...ranked
          .filter(l => paused.has(l))
          .map(lane => ({ lane, treatment: PAUSED })),
        ...startsHeld.map(lane => ({ lane, treatment: WAITING_TO_START })),
      ],
    },
    shadowDecisions,
    state: { lanesAllowedToCall: allowed, startsHeld, letGo },
  }
}
