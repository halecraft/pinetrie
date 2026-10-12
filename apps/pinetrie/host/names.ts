// host/names — every thread's name: planned for each thread or lane that has
// none, at start and for a new lane before its first run, and for a thread a
// column opens before it has a message.

import type { NameRecord, ThreadId } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readLaneRecords, readNames, readThreads } from "@pinetrie/reads"
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
  /**
   * Name every lane pi holds and every thread recorded that has none: at
   * start, for a new lane, and for a thread's first message.
   */
  ensure(): Promise<void>
  /**
   * Name the thread a column is about to create a lane for, and make its banner
   * due, named already or not.
   */
  reserve(lane: ThreadId): Promise<ReservePlan["kind"]>
}

/**
 * Both methods are steps on one queue, so two never plan the same name: each
 * reads the names the one before wrote. `onNamed` hears of each lane once its
 * name is written: what makes a new thread's banner.
 */
export function createNames(deps: {
  readonly basics: Pick<Basics, "session" | "now">
  readonly records: Pick<Records, "writeValues">
  readonly onNamed: (lane: ThreadId) => void
}): Names {
  const { session, now } = deps.basics
  const keeper = createKeeper()
  /** `agent`: a lane's, or one a column is about to create: due a banner. */
  const write = async (record: NameRecord, agent: boolean) => {
    await deps.records.writeValues([setRecord(NAME, record)])
    if (agent) deps.onNamed(record.lane)
  }
  return {
    ensure: () =>
      keeper.run(async () => {
        // Every lane has a record from its creation, in whichever root it
        // works, and every thread from its first message: a conversation thread
        // is named too.
        const lanes = readLaneRecords(session)
        const planned = planNames(
          [
            ...[...lanes.values()].map(r => ({
              lane: r.lane,
              createdAt: r.createdAt,
            })),
            ...[...readThreads(session).values()].map(r => ({
              lane: r.thread,
              createdAt: r.createdAt,
            })),
          ],
          readNames(session),
          now(),
        )
        // A conversation's thread is named, and draws no banner.
        for (const record of planned)
          await write(record, lanes.has(record.lane))
      }),
    reserve: lane =>
      keeper.run(async () => {
        const plan = planReserve(
          lane,
          new Set(readLaneRecords(session).keys()),
          readNames(session),
          now(),
        )
        if (plan.kind === "name") await write(plan.record, true)
        // A thread opened before its lane was named as a conversation's, with
        // no banner: its lane to come is due one.
        if (plan.kind === "known") deps.onNamed(lane)
        return plan.kind
      }),
  }
}
