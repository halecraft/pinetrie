// schema/storage — a root's document and the session's: their schemas, and
// the host's records in them, read and written.

import {
  type BoundSchema,
  batch,
  type DocRef,
  json,
  Schema,
} from "@kyneta/schema"
import type { ValueWrite } from "@pinetrie/core"
import { StoredEntryRowSchema } from "./pi-layout.ts"

/**
 * The host's records: a record's namespace, then its key, then its
 * contents, which its `RecordSpec` (`@pinetrie/rules`) decodes. A
 * namespace's first write creates its child record; the host is every
 * document's only writer, so no two replicas create one at once, which
 * would lose one's contents.
 */
const RecordsField = Schema.record(Schema.record(Schema.any()))

/**
 * A root's document: pi's storage, and the host's records keyed by its
 * entries. Authoritative JSON: the host is its only writer, and compacts it
 * between runs.
 *
 * `entries` is keyed by entry id, so a retried write replaces the same row.
 * `usageRows`, `values` and `lists` are pi's bookkeeping, typed `any`.
 * `checkpointText` holds the text of pi's tool-output checkpoints, written as
 * edits by `KynetaStorage`.
 */
export const RootDoc = json.bind(
  Schema.struct({
    entries: Schema.record(StoredEntryRowSchema),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    checkpointText: Schema.record(Schema.text()),
    records: RecordsField,
  }),
)

/** The session's document: the host's records read across roots, the directory among them. */
export const SessionDoc = json.bind(Schema.struct({ records: RecordsField }))

/** A root's document, as the Exchange gives it. */
export type RootDocHandle =
  typeof RootDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** The session's document, as the Exchange gives it. */
export type SessionDocHandle =
  typeof SessionDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** A document holding the host's records: a root's, or the session's. */
export type RecordsDocHandle = RootDocHandle | SessionDocHandle

const NO_RECORDS: Readonly<Record<string, unknown>> = Object.freeze({})

/**
 * Every record in `namespace`, by its key, as stored: the same object while
 * nothing in the namespace changes, whatever else is written, so a
 * reader can cache by it. An empty namespace is one shared empty object.
 */
export const readNamespace = (
  doc: RecordsDocHandle,
  namespace: string,
): Readonly<Record<string, unknown>> => doc.records.get(namespace) ?? NO_RECORDS

/** Every stored namespace in `doc`, with its records' keys. */
export const readStoredRecordKeys = (
  doc: RecordsDocHandle,
): ReadonlyMap<string, readonly string[]> =>
  new Map(
    doc.records
      .keys()
      .map(namespace => [
        namespace,
        Object.keys(readNamespace(doc, namespace)),
      ]),
  )

/**
 * The one writer of the host's records: `writes`, all to `doc`, in one batch.
 * A namespace's first write creates it, and its last delete removes it.
 */
export function applyRecordWrites(
  doc: RecordsDocHandle,
  writes: readonly ValueWrite[],
): void {
  if (writes.length === 0) return
  batch(doc, d => {
    for (const w of writes) {
      const held = d.records.at(w.namespace)
      if (w.kind === "set") {
        if (held === undefined) d.records.set(w.namespace, { [w.key]: w.value })
        else held.set(w.key, w.value)
      } else if (held?.has(w.key)) {
        held.delete(w.key)
        if (held.keys().length === 0) d.records.delete(w.namespace)
      }
    }
  })
}
