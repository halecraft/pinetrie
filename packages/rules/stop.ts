// stop — who stopped an ask's run (ADR-0056). pi's entries say that a run was
// aborted, never by whom (S70), so the host records it under the ask's
// prompt as it asks pi to abort (`planStop`). The first press is the
// one recorded: `planStop` writes no second.

import {
  type EntryId,
  type LaneName,
  type LaneView,
  promptOf,
  type StopRecord,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const StopSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each ask's stop, at its prompt's entry id. */
export const STOP: RecordSpec<StopRecord, EntryId, "root"> = {
  namespace: "pineta.stop",
  home: "root",
  keyOf: r => r.prompt,
  encode: ({ prompt, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(StopSchema, contents, entryKey(key), (r, prompt) => ({
      prompt,
      by: r.by as WriterId,
      at: r.at,
    })),
}

/** What stopping a thread's lane does (`planStop`). */
type StopPlan =
  | {
      readonly kind: "abort"
      /** Who stopped the ask; null when it is recorded already. */
      readonly record: StopRecord | null
    }
  | { readonly kind: "idle" }
  | { readonly kind: "unknown" }

/**
 * What stopping a thread's lane does: abort its running turn, recording who
 * stopped its ask (ADR-0056), unless someone's stop is recorded already, so
 * the first press is the one named; nothing when it is idle (stopping is
 * idempotent); refused for a lane that does not exist. Pure.
 */
export function planStop(
  lanes: readonly LaneView[],
  lane: LaneName,
  facts: {
    readonly index: TreeIndex
    readonly stops: ReadonlyMap<EntryId, StopRecord>
    readonly by: WriterId
    readonly now: number
  },
): StopPlan {
  const found = lanes.find(l => l.name === lane)
  if (found === undefined) return { kind: "unknown" }
  if (!found.running) return { kind: "idle" }
  const prompt = promptOf(facts.index, found.tip)
  return {
    kind: "abort",
    record:
      prompt === null || facts.stops.has(prompt)
        ? null
        : { prompt, by: facts.by, at: facts.now },
  }
}
