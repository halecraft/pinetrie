// host/machine/sink — the machine's health written as the session's one
// `pinetrie.machine` value, in a step of the documents' keeper, as every
// session record is. The manager never waits for it: a step on that keeper
// may wait on the manager's gate.

import { errorText, type MachineHealth } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import type { HealthSink } from "@pinetrie/machine"
import { readMachineHealth } from "@pinetrie/reads"
import { MACHINE, setIfChanged } from "@pinetrie/rules"
import type { SessionDocHandle } from "@pinetrie/schema"
import type { HostKeeper } from "../basics.ts"
import type { Records } from "../records.ts"

/**
 * Writes the latest value asked for, in a `once` step: every write asked
 * while one is queued merges into it, and one asked while it runs queues
 * one more, so the latest value is written in at most two steps.
 */
export function createHealthSink(deps: {
  readonly session: SessionDocHandle
  readonly keeper: Pick<HostKeeper, "once">
  readonly records: Pick<Records, "writeValues">
  /** A write the documents refused; a closed keeper's refusal is not told. */
  readonly onUnwritten: (error: string) => void
}): HealthSink {
  let latest: MachineHealth | null = null
  /** The step the latest write is in: merged writes share it, and are told once. */
  let pending: Promise<void> | null = null
  let flushed: Promise<void> = Promise.resolve()
  const writeLatest = async () => {
    if (latest === null) return
    await deps.records.writeValues(
      setIfChanged(
        MACHINE,
        latest,
        readMachineHealth(deps.session) ?? undefined,
      ),
    )
  }
  return {
    write(health) {
      latest = health
      const step = deps.keeper.once("machine-health", writeLatest)
      if (step === pending) return
      pending = step
      flushed = step.then(
        () => {},
        (error: unknown) => {
          if (!(error instanceof KeeperClosed))
            deps.onUnwritten(errorText(error))
        },
      )
    },
    writesFlushed: () => flushed,
  }
}
