// machine/manager — the loop that samples, plans and writes the health
// value, on a keeper of its own: its samples never overlap, and only the
// sink's write reaches the host's documents. It reads no clock: the host's
// timer asks for each sample.

import { errorText, type MachineHealth } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import {
  FIRST_MEMORY,
  type HealthMemory,
  planHealth,
  type SampleResult,
  STOPPED,
} from "./health.ts"
import type { HealthSink, MachineManager, MachineSensor } from "./ports.ts"
import type { StoreSettings } from "./store-settings.ts"

/** What the manager has to say, for the host to word and log. */
export type ManagerNews =
  | { readonly kind: "changed"; readonly health: MachineHealth }
  /** A sample, written or not, ran `ms` past the keeper's limit. */
  | { readonly kind: "slow"; readonly ms: number }
  /** The sink refused a write; the next sample tries again. */
  | { readonly kind: "unwritten"; readonly error: string }

export function createMachineManager(deps: {
  readonly sensor: MachineSensor
  readonly sink: HealthSink
  readonly settings: Pick<StoreSettings, "leaveFree">
  readonly tell: (news: ManagerNews) => void
}): MachineManager {
  const { sensor, sink, settings, tell } = deps
  const keeper = createKeeper<"sample">({
    onSlow: step => tell({ kind: "slow", ms: Math.round(step.ran) }),
  })
  let memory: HealthMemory = FIRST_MEMORY

  /** One write; on a refusal the memory forgets it, so the next sample writes again. */
  const writeHealth = async (health: MachineHealth, written: HealthMemory) => {
    try {
      await sink.write(health)
      memory = written
    } catch (error) {
      memory = { ...written, health: memory.health }
      tell({ kind: "unwritten", error: errorText(error) })
    }
  }

  const sampleOnce = async (): Promise<void> => {
    let result: SampleResult
    try {
      result = { kind: "sampled", sample: await sensor.sample() }
    } catch (error) {
      result = { kind: "failed", error: errorText(error) }
    }
    const planned = planHealth(memory, result, settings)
    if (!planned.changed) {
      memory = planned.memory
      return
    }
    await writeHealth(planned.health, planned.memory)
    tell({ kind: "changed", health: planned.health })
  }

  const sample = (): Promise<void> =>
    keeper.later("sample", sampleOnce).catch(() => {})

  return {
    async start() {
      await keeper.run(() => writeHealth(memory.health, memory))
      void sample()
    },
    sample,
    async close() {
      keeper.close("drop")
      await keeper.idle()
      await writeHealth(STOPPED, { ...memory, health: STOPPED })
    },
  }
}
