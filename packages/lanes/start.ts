// lanes/start — a lane's start as one decision: its container's plan, the
// facts it reads one at a time, and the steps of a start that makes its
// container.

import type { SnapshotId } from "@pinetrie/core"
import type { InnerDockerDataRootSource } from "./nested-data-root.ts"
import type { LaneRuntime } from "./runtime-port.ts"
import { diskBinds, planShape, shapeSpecHash } from "./shape.ts"
import type { LaneOwner, LaneSpec } from "./spec.ts"
import {
  planBindSources,
  planDiskThenStart,
  planStart,
  type Step,
} from "./steps.ts"

/** What starting a lane's container takes, from its state and label. */
export type ContainerPlan = "create" | "recreate" | "start" | "running"

/**
 * Missing: create it. Its label differs, or it has none: recreate it on the
 * same volume, since it was made from another spec (another image, mounts
 * or grants). Stopped: start it. The container holds nothing its volume
 * does not, so recreating it loses nothing.
 */
export function planContainer(input: {
  readonly facts: {
    readonly state: "running" | "stopped" | "missing"
    readonly label: string | null
  }
  readonly want: string
}): ContainerPlan {
  const { state, label } = input.facts
  if (state === "missing") return "create"
  if (label !== input.want) return "recreate"
  return state === "running" ? "running" : "start"
}

/** What a lane's start does (`planLaneStart`). */
export type LaneStart =
  | { readonly kind: "fork" }
  /** Read the fact named, add it to `LaneMade`, and decide again. */
  | { readonly kind: "gather"; readonly need: LaneFact }
  | { readonly kind: "container"; readonly plan: "start" | "running" }
  | { readonly kind: "disk"; readonly recreate: boolean }
  | {
      readonly kind: "snapshot"
      readonly from: SnapshotId
      readonly recreate: boolean
    }
  | { readonly kind: "retired" }

/** The next fact a start whose container must be made reads. */
export type LaneFact =
  /** Whether the lane's disk is there. */
  | { readonly kind: "disk" }
  /** Its revision records' snapshots and its history's kept one. */
  | { readonly kind: "history" }
  /** Whether this one snapshot is there. */
  | { readonly kind: "snapshot"; readonly snapshot: SnapshotId }

/** What a lane's start whose container must be made has read so far. */
export interface LaneMade {
  /** Whether its disk is there; null until read. */
  readonly disk: boolean | null
  /** Null until read: read only once its disk is known gone. */
  readonly history: {
    /** The snapshots its revision records name, newest first. */
    readonly own: readonly SnapshotId[]
    /** Whether any revision record names the lane, with a snapshot or not. */
    readonly recorded: boolean
    /** The snapshot of its newest state, kept off its disk (`LaneHistory.keptSnapshot`). */
    readonly kept: SnapshotId | null
  } | null
  /** Each snapshot checked, and whether it is there. */
  readonly exists: ReadonlyMap<SnapshotId, boolean>
}

/** A start whose container must be made, before it has read anything. */
export const NOTHING_MADE: LaneMade = {
  disk: null,
  history: null,
  exists: new Map(),
}

/**
 * A lane's start, from its fork's state and its container (`planContainer`).
 * A fork owed runs whatever is there. A begun lane whose container must be
 * made starts from its disk; else its newest snapshot that exists, a
 * revision's before its kept state's, since a turn that changed only
 * ignored files leaves the state older; else, with no turn recorded, its
 * files are its fork's, so it forks again; else what it recorded is gone,
 * and it is retired: a branch from it continues. It reads its facts one at
 * a time, as it needs them (`gather`): its history only once its disk is
 * gone, and its snapshots one each, newest first, until one is there.
 */
export function planLaneStart(input: {
  readonly fork: "owed" | "begun"
  readonly container: ContainerPlan
  readonly made: LaneMade
}): LaneStart {
  const { container, made } = input
  if (input.fork === "owed") return { kind: "fork" }
  if (container === "start" || container === "running")
    return { kind: "container", plan: container }
  const recreate = container === "recreate"
  if (made.disk === null) return { kind: "gather", need: { kind: "disk" } }
  if (made.disk) return { kind: "disk", recreate }
  const { history } = made
  if (history === null) return { kind: "gather", need: { kind: "history" } }
  const candidates = [
    ...history.own,
    ...(history.kept === null ? [] : [history.kept]),
  ]
  for (const snapshot of candidates) {
    const there = made.exists.get(snapshot)
    if (there === undefined)
      return { kind: "gather", need: { kind: "snapshot", snapshot } }
    if (there) return { kind: "snapshot", from: snapshot, recreate }
  }
  return history.recorded ? { kind: "retired" } : { kind: "fork" }
}

/** What a lane's start reads, one fact at a time (`decideLaneStart`). */
export interface LaneFactReader {
  disk(): Promise<boolean>
  history(): Promise<NonNullable<LaneMade["history"]>>
  snapshotExists(snapshot: SnapshotId): Promise<boolean>
}

/**
 * A lane's start, decided: `planLaneStart` again after each fact it asks
 * for, read through `read`, until it asks for none.
 */
export async function decideLaneStart(
  input: {
    readonly fork: "owed" | "begun"
    readonly container: ContainerPlan
  },
  read: LaneFactReader,
): Promise<Exclude<LaneStart, { readonly kind: "gather" }>> {
  let made = NOTHING_MADE
  for (;;) {
    const decided = planLaneStart({ ...input, made })
    if (decided.kind !== "gather") return decided
    const { need } = decided
    switch (need.kind) {
      case "disk":
        made = { ...made, disk: await read.disk() }
        break
      case "history":
        made = { ...made, history: await read.history() }
        break
      case "snapshot":
        made = {
          ...made,
          exists: new Map([
            ...made.exists,
            [need.snapshot, await read.snapshotExists(need.snapshot)],
          ]),
        }
        break
    }
  }
}

/**
 * A lane's start decided whole (`decideContainerStart`), with the steps it
 * runs before its container is running: a stopped container's start makes
 * the folders it binds (`planBindSources`); a disk's or a snapshot's makes
 * them and the container (`planStart`); a running container's runs none.
 * `dataRoot` is the source its steps make a nested lane's data root from,
 * for the host's count of them; null where they make none.
 */
export type ContainerStart =
  | Extract<LaneStart, { readonly kind: "fork" | "retired" }>
  | (Extract<
      LaneStart,
      { readonly kind: "container" | "disk" | "snapshot" }
    > & {
      readonly steps: readonly Step[]
      readonly dataRoot: InnerDockerDataRootSource | null
    })

/**
 * A lane's start, decided whole: its container's plan, from the container
 * as it is and the spec hash its shape wants (`planContainer`), then the
 * start, each fact read as it asks (`decideLaneStart`), with its steps
 * (`ContainerStart`). Only a start whose container is stopped or not yet
 * made touches its data root, which no running Docker may be on.
 */
export async function decideContainerStart(
  input: {
    readonly spec: LaneSpec<LaneOwner>
    readonly env: Readonly<Record<string, string | undefined>>
    readonly runtime: Pick<LaneRuntime, "runSpec">
    readonly facts: {
      readonly state: "running" | "stopped" | "missing"
      readonly label: string | null
    }
    readonly fork: "owed" | "begun"
    /** Where a nested lane's data root comes from, if this start makes it. */
    readonly dataRoot: InnerDockerDataRootSource
  },
  read: LaneFactReader,
): Promise<{
  readonly container: ContainerPlan
  readonly start: ContainerStart
}> {
  const { spec, env, dataRoot } = input
  const shape = planShape(spec, env)
  const container = planContainer({
    facts: input.facts,
    want: shapeSpecHash(input.runtime, shape),
  })
  const decided = await decideLaneStart({ fork: input.fork, container }, read)
  const made = diskBinds(shape).includes("nested") ? dataRoot : null
  switch (decided.kind) {
    case "container":
      return decided.plan === "running"
        ? { container, start: { ...decided, steps: [], dataRoot: null } }
        : {
            container,
            start: {
              ...decided,
              steps: planBindSources(spec, env, dataRoot),
              dataRoot: made,
            },
          }
    case "disk":
      return {
        container,
        start: {
          ...decided,
          steps: planStart(spec, env, dataRoot),
          dataRoot: made,
        },
      }
    case "snapshot":
      return {
        container,
        start: {
          ...decided,
          steps: planDiskThenStart({ spec, env, from: decided.from, dataRoot }),
          dataRoot: made,
        },
      }
    default:
      return { container, start: decided }
  }
}
