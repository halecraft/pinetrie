// 0002-records — the host's records move out of pi's `values` into `records`
// (ADR-0095, S120). A root's document keeps pi's fields and gains `records`;
// the session's document is made again with `records` alone.
//
// Each document is read first, and its move planned and checked, pure: every
// spec in `RECORD_SPECS` must decode the same records from the planned
// `records` as from the stored `values`. Then the writes.

import { batch, json, Schema } from "@kyneta/schema"
import {
  isHostNamespace,
  SESSION_TARGET,
  type ValueWrite,
} from "@pinetrie/core"
import { RECORD_SPECS } from "@pinetrie/rules"
import { applyRecordWrites, RootDoc, SessionDoc } from "@pinetrie/schema"
import type { Migration } from "./index.ts"

/** `StorageDoc`'s hash, the one schema of a root's and the session's before. */
const STORAGE_DOC = "02579936f2bb08f984d422ade586a2ae55"

/** The session as stored before: only the field this reads. */
const OldSession = json.bind(
  Schema.struct({ values: Schema.record(Schema.any()) }),
)

export interface RecordsMove {
  /** Each host record, as a write to `records`. */
  readonly writes: readonly ValueWrite[]
  /** The stored keys of the values the writes replace. */
  readonly moved: readonly string[]
  /** The namespaces of the values that stay: pi's own. */
  readonly kept: readonly string[]
}

/** A document's `values` -> the move of its host records. Pure. */
export function planRecordsMove(
  values: Readonly<Record<string, unknown>>,
): RecordsMove {
  const writes: ValueWrite[] = []
  const moved: string[] = []
  const kept: string[] = []
  for (const [pkey, stored] of Object.entries(values)) {
    const v = stored as { namespace?: unknown; key?: unknown; value?: unknown }
    if (
      typeof v?.namespace === "string" &&
      isHostNamespace(v.namespace) &&
      typeof v.key === "string"
    ) {
      writes.push({
        kind: "set",
        target: SESSION_TARGET,
        namespace: v.namespace,
        key: v.key,
        value: v.value,
      })
      moved.push(pkey)
    } else kept.push(typeof v?.namespace === "string" ? v.namespace : pkey)
  }
  return { writes, moved, kept }
}

interface Stored {
  readonly namespace?: unknown
  readonly key?: unknown
  readonly value?: unknown
}

/** Each record of `namespace` in `entries`, decoded at its address, in key order. */
const decodedIn = (
  entries: readonly Stored[],
  namespace: string,
  decode: (contents: unknown, key: string) => unknown,
): string =>
  JSON.stringify(
    entries
      .flatMap(e =>
        e.namespace === namespace && typeof e.key === "string"
          ? [[e.key, decode(e.value, e.key)] as const]
          : [],
      )
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )

/**
 * The namespaces whose records decode differently after `move` than from
 * `values`; empty when the move loses nothing. Pure.
 */
export function moveLosses(
  values: Readonly<Record<string, unknown>>,
  move: RecordsMove,
): readonly string[] {
  const before = Object.values(values) as readonly Stored[]
  return RECORD_SPECS.filter(
    s =>
      decodedIn(before, s.namespace, s.decode) !==
      decodedIn(move.writes, s.namespace, s.decode),
  ).map(s => s.namespace)
}

/** The session's records move into a document made again under `SessionDoc`. */
export const sessionRecords: Migration = {
  name: "0002-records",
  kind: "session",
  from: STORAGE_DOC,
  async run({ exchange, docIds, hydrated }) {
    const moves = new Map<string, RecordsMove>()
    for (const id of docIds) {
      const old = exchange.get(id, OldSession)
      await hydrated(id)
      const values = old.values()
      const move = planRecordsMove(values)
      if (move.kept.length > 0)
        throw new Error(
          `${id} holds values that are not the host's (${move.kept.join(", ")}), and the session's new schema has nowhere to keep them`,
        )
      const lost = moveLosses(values, move)
      if (lost.length > 0)
        throw new Error(`moving ${id} would change ${lost.join(", ")}`)
      moves.set(id, move)
    }
    return async () => {
      for (const [id, move] of moves) {
        // Made again, so the stored document holds only the new schema's
        // field: opened over the old one, the old fields would stay until a
        // compaction (S120).
        exchange.destroy(id)
        await exchange.flush()
        const fresh = exchange.get(id, SessionDoc)
        await exchange.whenHydrated(id)
        applyRecordWrites(fresh, move.writes)
      }
    }
  },
}

/** A root's records move from its `values` into its `records`. */
export const rootRecords: Migration = {
  name: "0002-records",
  kind: "root",
  from: STORAGE_DOC,
  async run({ exchange, docIds, hydrated }) {
    const moves = new Map<string, RecordsMove>()
    for (const id of docIds) {
      const doc = exchange.get(id, RootDoc)
      await hydrated(id)
      const values = doc.values()
      const move = planRecordsMove(values)
      const lost = moveLosses(values, move)
      if (lost.length > 0)
        throw new Error(`moving ${id} would change ${lost.join(", ")}`)
      moves.set(id, move)
    }
    return async () => {
      for (const [id, move] of moves) {
        const doc = exchange.get(id, RootDoc)
        applyRecordWrites(doc, move.writes)
        batch(doc, d => {
          for (const pkey of move.moved) d.values.delete(pkey)
        })
      }
    }
  },
}
