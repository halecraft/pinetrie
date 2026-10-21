// lanes/steps — what runs, as a list of `Step`s that `execute.ts` carries
// out: commands in the lane, and `RuntimeOp`s a runtime turns into its own
// commands. A container's start, a disk made for one, and a turn's
// snapshot.

import type { SnapshotId } from "@pinetrie/core"
import type { InnerDockerDataRootSource } from "./nested-data-root.ts"
import type { DiskOp, RuntimeOp } from "./runtime-port.ts"
import {
  type ContainerShape,
  type DiskBind,
  diskBinds,
  planShape,
} from "./shape.ts"
import type { LaneOwner, LaneSpec } from "./spec.ts"

/** One command in a lane, as data, run through the lane's runner. */
export interface LaneStep {
  readonly in: "lane"
  readonly argv: readonly string[]
  /** A host file the command's stdout is written to, as bytes. */
  readonly stdoutTo?: string
}

/** A lane command, or an operation of the runtime's. */
export type Step = LaneStep | { readonly in: "runtime"; readonly op: RuntimeOp }

export const inLane = (...argv: string[]): LaneStep => ({ in: "lane", argv })
export const onRuntime = (op: RuntimeOp): Step => ({ in: "runtime", op })
export const laneShell = (script: string): LaneStep =>
  inLane("sh", "-c", script)

/**
 * Ends every `ssh` process in a lane, found by its name in `/proc`, which
 * every image has. A revoke runs it after closing the lane's connections
 * through the host, for a session that went around them.
 */
export const KILL_SSH: LaneStep = laneShell(
  'cd /proc && for p in [0-9]*; do [ "$(cat "$p/comm" 2>/dev/null)" = ssh ] && kill "$p"; done; true',
)

declare const plannedStartBrand: unique symbol
/**
 * A container to make and start, as `planStart` plans it: the only value a
 * `run` step carries, so no plan makes a container without first making
 * the folders it binds.
 */
export interface PlannedStart {
  readonly shape: ContainerShape
  readonly [plannedStartBrand]: true
}

/** The disk operation that makes each folder a shape binds. */
const BIND_SOURCE: {
  readonly [B in DiskBind]: (
    lane: LaneOwner,
    dataRoot: InnerDockerDataRootSource,
  ) => DiskOp
} = {
  nested: (lane, dataRoot) => ({
    kind: "inner-docker-data-root",
    lane,
    cloneFromLane: dataRoot.kind === "clone" ? dataRoot.cloneFromLane : null,
  }),
  states: lane => ({ kind: "states-dir", lane }),
}

/**
 * The steps that make the folders `spec`'s container binds, before it is
 * made or a stopped one starts: a nested lane's data root from `dataRoot`,
 * which no running Docker may be on, and a folder lane's states directory.
 */
export const planBindSources = (
  spec: LaneSpec<LaneOwner>,
  env: Readonly<Record<string, string | undefined>>,
  dataRoot: InnerDockerDataRootSource,
): Step[] =>
  diskBinds(planShape(spec, env)).map(bind =>
    onRuntime(BIND_SOURCE[bind](spec.lane, dataRoot)),
  )

/**
 * What `planBindSources` makes a lane's data root from, for the host's count
 * of data roots (`InnerDockerDataRoots`); null for a lane that is not
 * nested, which makes none.
 */
export const dataRootMade = (
  spec: LaneSpec<LaneOwner>,
  env: Readonly<Record<string, string | undefined>>,
  dataRoot: InnerDockerDataRootSource,
): InnerDockerDataRootSource | null =>
  diskBinds(planShape(spec, env)).includes("nested") ? dataRoot : null

/**
 * Make and start a lane's container on its existing disk: the folders it
 * binds first (`planBindSources`), then the container.
 */
export const planStart = (
  spec: LaneSpec<LaneOwner>,
  env: Readonly<Record<string, string | undefined>>,
  dataRoot: InnerDockerDataRootSource,
): Step[] => {
  const shape = planShape(spec, env)
  return [
    ...planBindSources(spec, env, dataRoot),
    onRuntime({ kind: "run", start: { shape } as PlannedStart }),
  ]
}

/**
 * A lane's disk, then its container (`planStart`): a new disk, or one
 * restored from snapshot `from`.
 */
export const planDiskThenStart = (input: {
  readonly spec: LaneSpec<LaneOwner>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly from: SnapshotId | null
  readonly dataRoot: InnerDockerDataRootSource
}): Step[] => {
  const { lane } = input.spec
  return [
    onRuntime(
      input.from === null
        ? { kind: "create", lane }
        : { kind: "restore", lane, from: input.from },
    ),
    ...planStart(input.spec, input.env, input.dataRoot),
  ]
}

/**
 * A turn's snapshot: `sync`, so what the tools wrote is on the disk (without
 * it, unflushed files clone empty), then the snapshot.
 */
export const planSnapshot = (input: {
  readonly lane: LaneOwner
  readonly snapshot: SnapshotId
}): Step[] => [
  inLane("sync"),
  onRuntime({ kind: "snapshot", lane: input.lane, snapshot: input.snapshot }),
]
