// host/records — the host's writes of its own records: each document's writes
// in one batch, in the document their target names. Every module that writes a
// record takes this port, so a test asserts what was written, not how.

import type { ValueWrite } from "@pinetrie/core"
import { byTarget } from "@pinetrie/rules"
import { applyRecordWrites } from "@pinetrie/schema"
import type { HostDocuments } from "./docs.ts"

export interface Records {
  /**
   * Write `writes`: each document's in one batch, a root's opened if it is
   * not. A record can be written while a lane runs: nothing goes through pi.
   */
  writeValues(writes: readonly ValueWrite[]): Promise<void>
}

export function createRecords(
  docs: Pick<HostDocuments, "session" | "root">,
): Records {
  return {
    async writeValues(writes) {
      for (const [target, group] of byTarget(writes))
        applyRecordWrites(
          target.kind === "session"
            ? docs.session
            : await docs.root(target.root),
          group,
        )
    },
  }
}
