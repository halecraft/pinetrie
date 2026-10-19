// host/migrations/rewrite — a one-time change to one namespace's records,
// record by record, or to one kind of history message's stored details,
// message by message: the executors a record migration that only reshapes
// what it reads runs on. Each reads every document first (`recordDocs`, which
// other record migrations read with too), plans each write with the
// migration's pure rewrite, and writes only once every document has loaded.

import { batch } from "@kyneta/schema"
import {
  type HostNamespace,
  rootOfDocId,
  SESSION_TARGET,
  type Target,
  type ValueWrite,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  applyRecordWrites,
  PlacesDoc,
  type RecordsDocHandle,
  RootDoc,
  type RootDocHandle,
  readEntries,
  readNamespace,
  SessionDoc,
  type StoredEntryRow,
} from "@pinetrie/schema"
import type { MigrationRun, RecordMigration } from "./index.ts"

/**
 * A record's contents in the new shape; null for contents already in it, or
 * not this migration's to change. It must be null for its own output, so a
 * second run finds nothing.
 */
export type Rewrite = (contents: unknown) => object | null

/**
 * A rewrite that renames a record's top-level fields, `renames` old to new,
 * values untouched; null for a record that holds none of the old names. A
 * record holding both an old name and its new one keeps the new one's value.
 */
export const renamedFields =
  (renames: Readonly<Record<string, string>>): Rewrite =>
  contents => {
    if (contents === null || typeof contents !== "object") return null
    const stored = contents as Readonly<Record<string, unknown>>
    const old = Object.keys(renames).filter(k => k in stored)
    if (old.length === 0) return null
    const out: Record<string, unknown> = { ...stored }
    for (const k of old) {
      const to = renames[k] ?? k
      if (!(to in stored)) out[to] = stored[k]
      delete out[k]
    }
    return out
  }

/**
 * The writes to `target` that rewrite `stored`, `from`'s records. In place
 * (`to` is `from`), a set for each record `rewrite` changes. Into another
 * namespace, every record is set under `to`, rewritten or as stored, and
 * deleted from `from`: over its own output `from` is empty, so nothing is
 * planned.
 */
const planRewrites = (input: {
  readonly from: HostNamespace
  readonly to: HostNamespace
  readonly target: Target
  readonly stored: Readonly<Record<string, unknown>>
  readonly rewrite: Rewrite
}): readonly ValueWrite[] => {
  const { from, to, target } = input
  return Object.entries(input.stored).flatMap(
    ([key, contents]): readonly ValueWrite[] => {
      const value = input.rewrite(contents)
      if (to === from)
        return value === null
          ? []
          : [{ kind: "set", target, namespace: to, key, value }]
      return [
        { kind: "set", target, namespace: to, key, value: value ?? contents },
        { kind: "delete", target, namespace: from, key },
      ]
    },
  )
}

/**
 * Every document a home's records live in, the session's or every root's,
 * each loaded (`MigrationRun.hydrated`), with the target its writes name.
 */
export async function recordDocs(
  run: MigrationRun,
  home: "session" | "root",
): Promise<
  readonly { readonly doc: RecordsDocHandle; readonly target: Target }[]
> {
  const { exchange, docIds, hydrated } = run
  const docs: { doc: RecordsDocHandle; target: Target; id: string }[] =
    home === "session"
      ? docIds.includes(SESSION_DOC_ID)
        ? [
            {
              doc: exchange.get(SESSION_DOC_ID, SessionDoc),
              target: SESSION_TARGET,
              id: SESSION_DOC_ID,
            },
          ]
        : []
      : docIds.flatMap(id => {
          const root = rootOfDocId(id)
          return root === undefined
            ? []
            : [
                {
                  doc: exchange.get(id, RootDoc),
                  target: { kind: "root", root } as const,
                  id,
                },
              ]
        })
  for (const { id } of docs) await hydrated(id)
  return docs
}

/**
 * A record migration that rewrites each of `namespace`'s records in its
 * home, the session's document or every root's: in place, or moved to `to`.
 * A document's writes are one batch (`applyRecordWrites`), so no run leaves
 * a record in both namespaces.
 */
export function rewriteRecords(spec: {
  readonly name: string
  readonly namespace: HostNamespace
  /** The namespace the records move to; `namespace` itself when absent. */
  readonly to?: HostNamespace
  readonly home: "session" | "root"
  readonly rewrite: Rewrite
}): RecordMigration {
  return {
    name: spec.name,
    async run(input) {
      const planned = (await recordDocs(input, spec.home)).flatMap(
        ({ doc, target }) => {
          const writes = planRewrites({
            from: spec.namespace,
            to: spec.to ?? spec.namespace,
            target,
            stored: readNamespace(doc, spec.namespace),
            rewrite: spec.rewrite,
          })
          return writes.length === 0 ? [] : [{ doc, writes }]
        },
      )
      if (planned.length === 0) return null
      return async () => {
        for (const { doc, writes } of planned) applyRecordWrites(doc, writes)
      }
    },
  }
}

/**
 * Each stored row whose message is a history message of `customType`, its
 * `details` as `rewrite` gives them: null for none it changes. `content`,
 * what the model read, is never rewritten.
 */
export function planHistoryRewrites(
  rows: Readonly<Record<string, StoredEntryRow>>,
  customType: string,
  rewrite: Rewrite,
  renamedTo?: string,
): readonly StoredEntryRow[] {
  return Object.values(rows).flatMap(row => {
    const payload = row.payload as { readonly message?: unknown } | null
    const message = payload?.message
    if (message === null || typeof message !== "object") return []
    const m = message as {
      readonly customType?: unknown
      readonly details?: unknown
    }
    if (m.customType !== customType) return []
    const rewritten = rewrite(m.details)
    if (rewritten === null && renamedTo === undefined) return []
    const written = {
      ...m,
      details: rewritten ?? m.details,
      ...(renamedTo === undefined ? {} : { customType: renamedTo }),
    }
    return [{ ...row, payload: { ...payload, message: written } }]
  })
}

/**
 * A record migration that rewrites the stored `details` of every history
 * message of `customType`, in every root; with `renamedTo`, every such message
 * also takes that `customType`, its details unchanged where `rewrite` leaves
 * them.
 */
export function rewriteHistory(spec: {
  readonly name: string
  readonly customType: string
  readonly rewrite: Rewrite
  readonly renamedTo?: string
}): RecordMigration {
  return {
    name: spec.name,
    async run(input) {
      const roots: RootDocHandle[] = []
      for (const id of input.docIds) {
        if (rootOfDocId(id) === undefined) continue
        roots.push(input.exchange.get(id, RootDoc))
        await input.hydrated(id)
      }
      const planned = roots.flatMap(doc => {
        const rows = planHistoryRewrites(
          readEntries(doc),
          spec.customType,
          spec.rewrite,
          spec.renamedTo,
        )
        return rows.length === 0 ? [] : [{ doc, rows }]
      })
      if (planned.length === 0) return null
      return async () => {
        for (const { doc, rows } of planned)
          batch(doc, d => {
            for (const row of rows) d.entries.set(row.id, row)
          })
      }
    },
  }
}

/**
 * A record migration that rewrites each card's row in the places document,
 * live or trashed, by a pure rewrite of the row's flat fields: null for a row
 * it leaves.
 */
export function rewritePlacesRows(spec: {
  readonly name: string
  readonly rewrite: Rewrite
}): RecordMigration {
  return {
    name: spec.name,
    async run({ exchange, docIds, hydrated }) {
      if (!docIds.includes(PLACES_DOC_ID)) return null
      const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
      await hydrated(PLACES_DOC_ID)
      const rows = Object.entries(places.cards()).flatMap(([id, row]) => {
        const now = spec.rewrite(row)
        return now === null ? [] : [[id, now] as const]
      })
      if (rows.length === 0) return null
      return async () => {
        batch(places, d => {
          for (const [id, row] of rows)
            d.cards.set(id, row as Parameters<typeof d.cards.set>[1])
        })
      }
    },
  }
}
