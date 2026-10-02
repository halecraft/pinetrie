// host/names — every thread's name (ADR-0039): planned for each lane that has
// none, at start and for a new lane before its first run, and for a lane id a
// column reserves before its lane exists (ADR-0057).

import type { LaneName, NameRecord } from "@pineta/core"
import { planNames, planReserve, type ReservePlan } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readLaneRecords, readNames } from "@pineta/reads"
import { readLaneNames } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import { createSerial } from "./queue.ts"

export interface Names {
  /** Name every lane pi holds that has none: at start, and for a new lane. */
  ensure(): Promise<void>
  /** Name the thread a column's reserved lane id will be (ADR-0057). */
  reserve(lane: LaneName): Promise<ReservePlan["kind"]>
}

/**
 * Both methods are steps on one queue, so two never plan the same name: each
 * reads the names the one before wrote. `onNamed` hears of each lane once its
 * name is written: what makes a new thread's banner.
 */
export function createNames(deps: {
  readonly basics: Pick<Basics, "doc" | "now">
  readonly agent: Pick<Agent, "setWorkRecord">
  readonly onNamed: (lane: LaneName) => void
}): Names {
  const { doc, now } = deps.basics
  const serial = createSerial()
  const write = async (record: NameRecord) => {
    await deps.agent.setWorkRecord({ kind: "name", record })
    deps.onNamed(record.lane)
  }
  return {
    ensure: () =>
      serial.run(async () => {
        const records = readLaneRecords(doc)
        const planned = planNames(
          readLaneNames(doc).map(stored => {
            const lane = stored as LaneName
            return { lane, createdAt: records.get(lane)?.createdAt ?? 0 }
          }),
          readNames(doc),
          now(),
        )
        for (const record of planned) await write(record)
      }),
    reserve: lane =>
      serial.run(async () => {
        const plan = planReserve(
          lane,
          new Set(readLaneNames(doc)),
          readNames(doc),
          now(),
        )
        if (plan.kind === "name") await write(plan.record)
        return plan.kind
      }),
  }
}
