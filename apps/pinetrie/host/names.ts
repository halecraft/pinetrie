// host/names — every thread's name (ADR-0039): planned for each lane that has
// none, at start and for a new lane before its first run, and for a lane id a
// column reserves before its lane exists (ADR-0057).

import type { LaneName, NameRecord } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readLaneRecords, readNames } from "@pinetrie/reads"
import {
  NAME,
  planNames,
  planReserve,
  type ReservePlan,
  setRecord,
} from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import type { Records } from "./records.ts"

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
  readonly basics: Pick<Basics, "session" | "now">
  readonly records: Pick<Records, "writeValues">
  readonly onNamed: (lane: LaneName) => void
}): Names {
  const { session, now } = deps.basics
  const keeper = createKeeper()
  const write = async (record: NameRecord) => {
    await deps.records.writeValues([setRecord(NAME, record)])
    deps.onNamed(record.lane)
  }
  return {
    ensure: () =>
      keeper.run(async () => {
        // Every lane has a record from its creation (ADR-0063), in whichever
        // root it works.
        const records = readLaneRecords(session)
        const planned = planNames(
          [...records.values()].map(r => ({
            lane: r.lane,
            createdAt: r.createdAt,
          })),
          readNames(session),
          now(),
        )
        for (const record of planned) await write(record)
      }),
    reserve: lane =>
      keeper.run(async () => {
        const plan = planReserve(
          lane,
          new Set(readLaneRecords(session).keys()),
          readNames(session),
          now(),
        )
        if (plan.kind === "name") await write(plan.record)
        return plan.kind
      }),
  }
}
