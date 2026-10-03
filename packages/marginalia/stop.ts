// stop — who stopped an ask's run (ADR-0056). pi's entries say that a run was
// aborted, never by whom (S70), so the host records it under the ask's
// prompt as it asks pi to abort (`planStop`, in core). The first press is the
// one recorded: `planStop` writes no second.

import type { EntryId, StopRecord, WriterId } from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const StopSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each ask's stop, at its prompt's entry id. */
export const STOP: RecordSpec<StopRecord, EntryId> = {
  namespace: "pineta.stop",
  keyOf: r => r.prompt,
  encode: ({ prompt, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(StopSchema, contents, entryKey(key), (r, prompt) => ({
      prompt,
      by: r.by as WriterId,
      at: r.at,
    })),
}
