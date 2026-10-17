// host/migrations/0021-entry-words — the words a thread's stored entries carry
// for pine·trie to read back follow the code: a canvas, not a task, and a
// person's message, not a chat. Each root's entries are read raw, by
// `customType`, since an old one no longer decodes:
//
// - a person's message is stored as one (`pinetrie.chat` becomes
//   `pinetrie.message`), so the column draws it and pi gives it to the model
//   again;
// - the cards pinned to a task are stored as the cards pinned to its canvas
//   (`pinetrie.task-pinned` becomes `pinetrie.canvas-pinned`);
// - a canvas list, a canvas's news, the cards pinned to it and a send not
//   delivered name their canvas in `details`.
//
// An entry's `content`, the text the model read, is never rewritten, nor its
// id or its parent. It writes only when it finds an old entry, so a second
// start writes nothing. Delete this file and its test once Duane's store
// has run it.

import { batch } from "@kyneta/schema"
import { rootOfDocId } from "@pinetrie/core"
import {
  RootDoc,
  type RootDocHandle,
  readEntries,
  type StoredEntryRow,
} from "@pinetrie/schema"
import { renamedFact } from "./0019-canvas-places.ts"
import type { RecordMigration } from "./index.ts"

/** Each old `customType` and the one it is stored as now. */
const TYPES: Readonly<Record<string, string>> = {
  "pinetrie.chat": "pinetrie.message",
  "pinetrie.task-pinned": "pinetrie.canvas-pinned",
}

/** The kinds whose `details` name a task at their top. */
const NAMED: ReadonlySet<string> = new Set([
  "pinetrie.canvas",
  "pinetrie.canvas-fact",
  "pinetrie.task-pinned",
])

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A stored message renamed; the same value when nothing in it is old. */
function renamedMessage(message: unknown): unknown {
  if (!isRaw(message) || typeof message.customType !== "string") return message
  const type = message.customType
  const details = message.details
  let next: unknown = details
  if (NAMED.has(type) && isRaw(details) && "task" in details) {
    const { task, ...rest } = details
    next = { ...rest, canvas: task }
  } else if (type === "pinetrie.fact") next = renamedFact(details)
  const customType = TYPES[type] ?? type
  return next === details && customType === type
    ? message
    : { ...message, customType, details: next }
}

/** Each entry of a root whose message changed, whole. */
export function planEntryWords(
  rows: Readonly<Record<string, StoredEntryRow>>,
): readonly StoredEntryRow[] {
  return Object.values(rows).flatMap(row => {
    const payload = row.payload as { message?: unknown } | null
    if (!isRaw(payload)) return []
    const message = renamedMessage(payload.message)
    return message === payload.message
      ? []
      : [{ ...row, payload: { ...payload, message } } as StoredEntryRow]
  })
}

export const entryWords: RecordMigration = {
  name: "0021-entry-words",
  async run({ exchange, docIds, hydrated }) {
    const planned: {
      readonly doc: RootDocHandle
      readonly rows: readonly StoredEntryRow[]
    }[] = []
    for (const docId of docIds) {
      if (rootOfDocId(docId) === undefined) continue
      const doc = exchange.get(docId, RootDoc)
      await hydrated(docId)
      const rows = planEntryWords(readEntries(doc))
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
