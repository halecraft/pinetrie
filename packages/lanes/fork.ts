// lanes/fork — a fork's steps, as one value only `planFork` makes and only
// `executeFork` runs.

import { type SnapshotId, type ThreadId, WORKSPACE_ROOT } from "@pinetrie/core"
import type { ForkSetup } from "./history-port.ts"
import type { InnerDockerDataRootSource } from "./nested-data-root.ts"
import { type LaneSpec, laneContainer } from "./spec.ts"
import { laneShell, onRuntime, planDiskThenStart, type Step } from "./steps.ts"

/**
 * pre-rename: the lane's jj config folder before b05e2252. Snapshots taken
 * of lanes made before then still hold it, and `laneIgnores` does not list
 * it, so a turn would commit it. Remove with `planOldNamesOnDisk` once no
 * such snapshot remains.
 */
export const OLD_LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pineta-lane`
declare const forkStepsBrand: unique symbol
/** A fork's steps, as `planFork` plans them: the only steps `executeFork` runs. */
export interface ForkSteps {
  readonly lane: ThreadId
  readonly steps: readonly Step[]
  readonly [forkStepsBrand]: true
}

/**
 * A fork: the lane's container and disk deleted first, whatever a fork
 * stopped part way left, so a fork runs again from the top; then its disk
 * cloned from the adapter's snapshot (`ForkSetup.from`), else its source's,
 * then the adapter's setup steps.
 */
export const planFork = (input: {
  readonly source: { readonly snapshot: SnapshotId }
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
  readonly setup: ForkSetup
  /** Where a nested lane's inner Docker data root comes from. */
  readonly innerDockerDataRoot: InnerDockerDataRootSource
}): ForkSteps => {
  const { lane } = input.spec
  const steps: Step[] = [
    onRuntime({ kind: "remove", container: laneContainer(lane) }),
    // Drops the nested disk too: the start below makes the data root again,
    // before the run whose inner Docker starts on it.
    onRuntime({ kind: "delete", lane }),
    ...planDiskThenStart({
      ...input,
      from: input.setup.from ?? input.source.snapshot,
      dataRoot: input.innerDockerDataRoot,
    }),
    // pre-rename: before any command of the adapter's, which could snapshot
    // it into the working copy the clone carries (`OLD_LANE_CONFIG_DIR`).
    laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),
    ...input.setup.steps,
  ]
  return { lane, steps } as unknown as ForkSteps
}
