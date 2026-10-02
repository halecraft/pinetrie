// stop — who stopped an ask's run (ADR-0056). pi's entries say that a run was
// aborted, never by whom (S70), so the host records it under the ask's
// prompt as it asks pi to abort (`planStop`, in core). The first press is the
// one recorded: `planStop` writes no second.

import type { StopRecord, WriterId } from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

/** pi value namespace for stops. The key is the ask's prompt. */
export const STOP_NAMESPACE = "pineta.stop"

const StopSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** A stop -> the plain value stored in pi. */
export const encodeStop = (r: StopRecord) => ({ ...r })

export const decodeStop = (value: unknown): StopRecord | undefined =>
  decodeWith(StopSchema, value, r => ({ by: r.by as WriterId, at: r.at }))

/** Stored `pineta.stop` values -> each ask's stop, by its prompt. */
export function stopRecords(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<string, StopRecord> {
  const out = new Map<string, StopRecord>()
  for (const { key, value } of values) {
    const r = decodeStop(value)
    if (r !== undefined) out.set(key, r)
  }
  return out
}
