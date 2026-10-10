// host/migrations/0011-thread-origin — a thread's origin names its fork
// alone (ADR-0126): a root's first thread, or a fork at an entry, a branch
// or a copy. A copy's source is the thread its fork entry is in (ADR-0125),
// so it is no longer stored. Records' contents change and no schema's hash
// does: a record migration, due while a stored origin is `started` or
// `copy`.
//
// - `copy` at `fork` becomes a fork there, `how: "copy"`.
// - `started` becomes a fork at its first entry's parent, `how: "branch"`;
//   or a root's first thread when that parent is none (a new root's first
//   message), or its root holds no entry of it; spun from a card when a
//   card's place row says it was spun into it (`spun`, its thread in
//   `lane`): the card goes to its spinner's trash (0012), and the record
//   keeps what lifts the thread back into it.
//
// One-time: delete this file once Duane's store has run it.

import {
  type EntryId,
  isRootId,
  type RootId,
  rootDocId,
  SESSION_TARGET,
  type TextCardId,
  type ThreadId,
  type ThreadOrigin,
  type TreeIndex,
  type ValueWrite,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readTreeIndex } from "@pinetrie/reads"
import { THREAD } from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  RootDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/** A stored thread record, as far as this migration reads it. */
interface StoredThread {
  readonly root?: unknown
  readonly origin?: { readonly kind?: unknown; readonly fork?: unknown }
}

const isOld = (stored: unknown): stored is StoredThread => {
  if (stored === null || typeof stored !== "object") return false
  const { origin } = stored as StoredThread
  return origin?.kind === "started" || origin?.kind === "copy"
}

/** The roots whose trees a started thread's new origin is read from. */
export const rootsToRead = (
  stored: Readonly<Record<string, unknown>>,
): readonly RootId[] => [
  ...new Set(
    Object.values(stored).flatMap(r =>
      isOld(r) &&
      r.origin?.kind === "started" &&
      typeof r.root === "string" &&
      isRootId(r.root)
        ? [r.root]
        : [],
    ),
  ),
]

/** A stored place row, its fields as strings. */
type Row = Readonly<Record<string, string>>

/** Each thread a stored card was spun into, by the card's id: its `spun` rows. */
export const spunFrom = (
  rows: Readonly<Record<string, Readonly<Record<string, string>>>>,
): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(rows).flatMap(([id, row]) =>
      row.kind === "spun" && (row.lane ?? "") !== ""
        ? [[row.lane ?? "", id] as const]
        : [],
    ),
  )

/** Where a started thread forks: its first entry's parent; null for none. */
const parentOfFirst = (
  index: TreeIndex | undefined,
  thread: string,
): EntryId | null => {
  const first = index?.firstOf.get(thread as ThreadId)
  if (index === undefined || first === undefined) return null
  const parent = index.parentOf(first)
  return parent === null || index.entries[parent] === undefined ? null : parent
}

/**
 * Each stored thread record in the old shape, rewritten, pure. Empty when
 * every origin is in the new shape, so a second run finds nothing.
 */
export function planThreadOrigins(input: {
  readonly stored: Readonly<Record<string, unknown>>
  /** The tree of each root `rootsToRead` named that loaded. */
  readonly trees: ReadonlyMap<string, TreeIndex>
  /** Each thread a card was spun into, by the card (`spunFrom`). */
  readonly spun: ReadonlyMap<string, string>
}): readonly ValueWrite[] {
  return Object.entries(input.stored).flatMap(([key, stored]) => {
    if (!isOld(stored)) return []
    const { origin } = stored
    const card = input.spun.get(key)
    const fork =
      origin?.kind === "copy"
        ? typeof origin.fork === "string"
          ? (origin.fork as EntryId)
          : null
        : parentOfFirst(
            typeof stored.root === "string"
              ? input.trees.get(stored.root)
              : undefined,
            key,
          )
    const next: ThreadOrigin =
      card !== undefined && origin?.kind === "started"
        ? { kind: "spun", card: card as TextCardId }
        : fork === null
          ? { kind: "root" }
          : {
              kind: "fork",
              at: fork,
              how: origin?.kind === "copy" ? "copy" : "branch",
            }
    return [
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: THREAD.namespace,
        key,
        value: { ...stored, origin: next },
      } as const,
    ]
  })
}

export const threadOrigin: RecordMigration = {
  name: "0011-thread-origin",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const stored = readNamespace(session, THREAD.namespace)
    const places = docIds.includes(PLACES_DOC_ID)
      ? exchange.get(PLACES_DOC_ID, PlacesDoc)
      : null
    if (places !== null) await hydrated(PLACES_DOC_ID)
    const rows: Readonly<Record<string, Readonly<Record<string, string>>>> =
      places === null ? {} : (places.cards() as Readonly<Record<string, Row>>)
    const trees = new Map<string, TreeIndex>()
    for (const root of rootsToRead(stored)) {
      const id = rootDocId(root)
      if (!docIds.includes(id)) continue
      const doc = exchange.get(id, RootDoc)
      await hydrated(id)
      trees.set(root, readTreeIndex(doc))
    }
    const writes = planThreadOrigins({ stored, trees, spun: spunFrom(rows) })
    if (writes.length === 0) return null
    return async () => applyRecordWrites(session, writes)
  },
}
