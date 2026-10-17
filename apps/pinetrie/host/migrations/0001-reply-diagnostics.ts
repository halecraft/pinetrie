// host/migrations/0001-reply-diagnostics — each stored reply's list of the
// thinking Anthropic dropped, stored as its count (`countedDiagnostics`, the
// one rule a new reply is stored by too). Each root's entries are read raw;
// an entry's `content`, id and parent are never rewritten, so a thread's
// history and its prompt cache stay as they were: no provider is sent a
// reply's diagnostics. Over its own output it plans nothing, so a start that
// dies before the ledger records it runs it again harmlessly.

import { batch } from "@kyneta/schema"
import { rootOfDocId } from "@pinetrie/core"
import { countedDiagnostics } from "@pinetrie/pi"
import {
  RootDoc,
  type RootDocHandle,
  readEntries,
  type StoredEntryRow,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Each entry of a root whose reply's diagnostics change, whole. */
export function planCountedDiagnostics(
  rows: Readonly<Record<string, StoredEntryRow>>,
): readonly StoredEntryRow[] {
  return Object.values(rows).flatMap(row => {
    const payload = row.payload
    if (!isRaw(payload)) return []
    const message = payload.message
    if (!isRaw(message) || message.role !== "assistant") return []
    const diagnostics = countedDiagnostics(message.diagnostics)
    return diagnostics === message.diagnostics
      ? []
      : [
          {
            ...row,
            payload: { ...payload, message: { ...message, diagnostics } },
          } as StoredEntryRow,
        ]
  })
}

export const REPLY_DIAGNOSTICS: RecordMigration = {
  name: "0001-reply-diagnostics",
  async run({ exchange, docIds, hydrated }) {
    const planned: {
      readonly doc: RootDocHandle
      readonly rows: readonly StoredEntryRow[]
    }[] = []
    for (const docId of docIds) {
      if (rootOfDocId(docId) === undefined) continue
      const doc = exchange.get(docId, RootDoc)
      await hydrated(docId)
      const rows = planCountedDiagnostics(readEntries(doc))
      if (rows.length > 0) planned.push({ doc, rows })
    }
    if (planned.length === 0) return null
    return async () => {
      for (const { doc, rows } of planned)
        batch(doc, d => {
          for (const row of rows) d.entries.set(row.id, row)
        })
    }
  },
}
