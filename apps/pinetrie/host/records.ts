// host/records — the host's writes of its own records: each document's writes
// in one batch, in the document their target names. Every module that writes a
// record takes this port, so a test asserts what was written, not how.
//
// Two ports. `Records` writes the session's records alone, and is what a
// module gets as it is made. A root's record is written only through a step's
// documents (`StepDocs.records`, `roots.ts`), which load the root first: a
// write's home is in its type (`ValueWrite<H>`), so one into a root outside a
// step does not compile.

import type { Home, ValueWrite } from "@pinetrie/core"
import { byTarget } from "@pinetrie/rules"
import {
  applyRecordWrites,
  type RootDocHandle,
  type SessionDocHandle,
} from "@pinetrie/schema"

export interface WriteRecords<H extends Home> {
  /**
   * Write `writes`: each document's in one batch. A record can be written
   * while a lane runs: nothing goes through pi. A property, not a method: a
   * method's parameter is checked both ways, which would let the session's
   * port stand in for one that writes into roots.
   */
  readonly writeValues: (writes: readonly ValueWrite<H>[]) => Promise<void>
}

/** The session's records. */
export type Records = WriteRecords<"session">

/** The session's records and the roots' a step loads. */
export type StepRecords = WriteRecords<Home>

export function createRecords(session: SessionDocHandle): Records {
  return {
    async writeValues(writes) {
      if (writes.length > 0) applyRecordWrites(session, writes)
    },
  }
}

/** Every record's writer, a root's loaded through `root`. */
export function createStepRecords(input: {
  readonly session: SessionDocHandle
  readonly root: (
    root: ValueWrite<"root">["target"]["root"],
  ) => Promise<RootDocHandle>
}): StepRecords {
  return {
    async writeValues(writes) {
      for (const [target, group] of byTarget(writes))
        applyRecordWrites(
          target.kind === "session"
            ? input.session
            : await input.root(target.root),
          group,
        )
    },
  }
}
