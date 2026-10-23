// host/machine/repair — the lane VM's repair, composed from `@pinetrie/vm`'s
// steps for the machine package's executor (`runRepairSteps`): the repair
// lock and the launcher's as the proofs each step takes, the VM's own
// growth rule, and the repair boot's report mapped to what the machine
// keeps. Made only for the lane VM, by a host that manages it.

import path from "node:path"
import {
  encodeRepairState,
  type RepairControls,
  type RepairOutcome,
  type RepairRead,
} from "@pinetrie/machine"
import {
  awaitLauncherGone,
  type DataDiskPlan,
  gatherDataDisk,
  growDataDisk,
  type LauncherLockHeld,
  type RepairLockHeld,
  type RepairReport,
  readRepairFacts,
  repairBootMissing,
  repairDataDisk,
  stopVmForRepair,
  takeRepairLock,
  writeRepairState,
} from "@pinetrie/vm"

/** The lane VM's repair controls, for the machine's executor. */
export type LaneVmRepairControls = RepairControls<
  RepairLockHeld,
  LauncherLockHeld
>

/** What the machine keeps of a repair boot's report. */
export const repairOutcome = (report: RepairReport): RepairOutcome => ({
  leftUnallocated: report.left?.unallocated ?? null,
  leftMetadata:
    report.left === null
      ? null
      : { size: report.left.metadataSize, used: report.left.metadataUsed },
  failed: report.failed,
})

/**
 * The repair's controls on the lane VM of `stateDir`: its data disk grown
 * by `growData`, the plan a start grows it by, so a start and a repair
 * share one growth rule.
 */
export function laneVmRepairControls(input: {
  readonly stateDir: string
  readonly growData: DataDiskPlan
  readonly log: (line: string) => void
}): LaneVmRepairControls {
  const { stateDir, log } = input
  const dataPath = path.join(stateDir, "data.img")
  const diskSize = async () =>
    (await gatherDataDisk(dataPath, stateDir))?.size ?? 0
  return {
    async takeRepairLock() {
      return takeRepairLock(stateDir)
    },
    lockLost: held => held.lock.lockLost,
    readRepair: () => readRepairFacts(stateDir),
    repairBootMissing: () => repairBootMissing(stateDir),
    diskSize,
    stopVmForRepair: held => stopVmForRepair(held),
    async awaitLauncherGone(held) {
      const launcher = await awaitLauncherGone(held, () =>
        log("[vm] waiting for the lane VM's launcher to exit, for the repair"),
      )
      if (!("lock" in launcher))
        throw new Error(
          `the lane VM's launcher lock could not be taken: ${launcher.detail}`,
        )
      return launcher
    },
    async growForRepair() {
      const grown = await growDataDisk(dataPath, stateDir, input.growData)
      if (grown !== null)
        log(
          `[vm] the lanes' disk grows from ${grown.from} to ${grown.to} bytes for its repair`,
        )
      return diskSize()
    },
    async bootRepair(_held, launcherHeld, onLine) {
      const report = await repairDataDisk({
        stateDir,
        launcherHeld,
        log: line => {
          log(`[vm] ${line}`)
          onLine(line)
        },
      })
      return repairOutcome(report)
    },
    writeRepairState: (held, state) =>
      writeRepairState(held, encodeRepairState(state)),
    async releaseRepairLocks(held, launcherHeld) {
      await launcherHeld?.lock.release()
      await held.lock.release()
    },
  }
}

/** The lane VM's shared repair state, as any host reads it each sample. */
export const laneVmRepairRead = (stateDir: string) => (): Promise<RepairRead> =>
  readRepairFacts(stateDir)
