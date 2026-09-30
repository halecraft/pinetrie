// host/names — every lane's thread name (ADR-0039): planned for each lane
// that has none, at start and for a new lane before its first run.

import type { LaneName } from "@pineta/core"
import { planNames } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readLaneRecords, readNames } from "@pineta/reads"
import { readLaneNames } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import { createSerial } from "./queue.ts"

/**
 * Name every lane that has none. One at a time, so two never plan the same
 * name: each reads the names the one before wrote.
 */
export function createNames(deps: {
  readonly basics: Pick<Basics, "doc" | "now">
  readonly agent: Pick<Agent, "setWorkRecord">
}): () => Promise<void> {
  const { doc, now } = deps.basics
  const serial = createSerial()
  return () =>
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
      for (const record of planned)
        await deps.agent.setWorkRecord({ kind: "name", record })
    })
}
