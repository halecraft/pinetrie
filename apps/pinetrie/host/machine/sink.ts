// host/machine/sink — the machine's health written as the session's one
// `pinetrie.machine` value, in a step of the documents' keeper, as every
// session record is.

import type { MachineHealth } from "@pinetrie/core"
import type { HealthSink } from "@pinetrie/machine"
import { readMachineHealth } from "@pinetrie/reads"
import { MACHINE, setIfChanged } from "@pinetrie/rules"
import type { SessionDocHandle } from "@pinetrie/schema"
import type { HostKeeper } from "../basics.ts"
import type { Records } from "../records.ts"

export function createHealthSink(deps: {
  readonly session: SessionDocHandle
  readonly keeper: Pick<HostKeeper, "run">
  readonly records: Pick<Records, "writeValues">
}): HealthSink {
  return {
    write: (health: MachineHealth) =>
      deps.keeper.run(() =>
        deps.records.writeValues(
          setIfChanged(
            MACHINE,
            health,
            readMachineHealth(deps.session) ?? undefined,
          ),
        ),
      ),
  }
}
