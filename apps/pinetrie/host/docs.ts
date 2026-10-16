// host/docs — the session's documents as the host holds them: the session's,
// `pinetrie:live`, the places, and a document per root, opened when first asked
// for and let go when its root is archived.

import type { Exchange } from "@kyneta/exchange"
import {
  type EntryId,
  type RootId,
  rootDocId,
  type ThreadId,
} from "@pinetrie/core"
import type { RootView } from "@pinetrie/reads"
import {
  readArchived,
  readLaneRecords,
  readPlaces,
  readRoots,
  readStartedRoots,
  readThreads,
} from "@pinetrie/reads"
import { rootsHeld } from "@pinetrie/rules"
import {
  type LiveDocHandle,
  type PlacesDocHandle,
  RootDoc,
  type RootDocHandle,
  type SessionDocHandle,
} from "@pinetrie/schema"

export interface HostDocuments {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
  /** A root's document, held and loaded: opened if it is not. */
  root(root: RootId): Promise<RootDocHandle>
  /** A loaded root's documents, or null: a synchronous step plans from what it holds. */
  view(root: RootId): RootView | null
  /** The root a lane works in, from its record (`LANE`); null for none. */
  rootOfLane(lane: ThreadId): RootId | null
  /** The loaded document of the root a lane works in, or null. */
  docOfLane(lane: ThreadId): RootDocHandle | null
  /** The document of the root a lane works in, opened if it is not; null for a lane no root holds. */
  laneDoc(lane: ThreadId): Promise<RootDocHandle | null>
  /** The root whose root entry is `entry` (`ROOT.entry`); null for none. */
  rootOfEntry(entry: EntryId): RootId | null
  /**
   * Let a root's document go from memory, once what holds it has let go
   * (`onReleasing`'s listeners); it stays in the store.
   */
  unload(root: RootId): Promise<void>
  /**
   * Destroy a root's document, in memory and in the store, telling every peer;
   * what holds it lets go first, as for `unload`.
   */
  destroy(root: RootId): Promise<void>
  /** The roots whose documents are held now. */
  loaded(): readonly RootId[]
  /**
   * Call `listener` for every root held now, then for each root as it is
   * opened (a root unloaded and opened again is heard again). A root still
   * loading when it joins is heard once, as it finishes.
   */
  onOpened(listener: (root: RootId, doc: RootDocHandle) => void): void
  /**
   * Call `listener` as a root's document is about to go, in the order
   * listeners joined: whatever holds it lets go, so nothing writes to a
   * closed document. `unload` awaits each.
   */
  onReleasing(listener: (root: RootId) => Promise<void>): void
}

/**
 * What a starting host says it opened: `opened` of the directory's `total`
 * roots; every other root is in archived canvases alone (`planLoads`).
 */
export const rootsOpenedWords = (counts: {
  readonly opened: number
  readonly total: number
}): string => {
  const { opened, total } = counts
  const archived = total - opened
  const roots = `opened ${opened} of ${total} ${total === 1 ? "root" : "roots"}`
  return archived === 0 ? roots : `${roots} (${archived} archived)`
}

/**
 * The roots a starting host opens: every root with a thread in a canvas outside
 * the archive, or in an inventory (`rootsHeld`), from the threads' records,
 * whatever the directory holds: a root whose directory record is stale is
 * opened all the same, and the directory rewrites it as it starts to follow
 * the root. A busy canvas cannot be
 * archived (`planArchive`), so these hold every lane a crash could have
 * interrupted. In order, by id.
 */
export const planLoads = (held: ReadonlySet<RootId>): readonly RootId[] =>
  [...held].sort()

/** The roots a starting host opens (`planLoads`), read from the session and the places. */
export const startingLoads = (docs: {
  readonly session: SessionDocHandle
  readonly places: PlacesDocHandle
}): readonly RootId[] =>
  planLoads(
    rootsHeld(
      readPlaces(docs.places),
      readThreads(docs.session),
      new Set(readArchived(docs.session, docs.places).keys()),
      readStartedRoots(docs.session),
    ),
  )

export function hostDocuments(input: {
  readonly exchange: Exchange
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
}): HostDocuments {
  const { exchange, session, live, places } = input
  const held = new Map<RootId, RootDocHandle>()
  const loading = new Map<RootId, Promise<RootDocHandle>>()
  const listeners: ((root: RootId, doc: RootDocHandle) => void)[] = []
  const releasing: ((root: RootId) => Promise<void>)[] = []

  return {
    session,
    live,
    places,
    root(root) {
      const known = held.get(root)
      if (known !== undefined) return Promise.resolve(known)
      const pending = loading.get(root)
      if (pending !== undefined) return pending
      const id = rootDocId(root)
      const doc = exchange.get(id, RootDoc)
      const ready = exchange.whenHydrated(id).then(() => {
        loading.delete(root)
        held.set(root, doc)
        for (const listener of listeners) listener(root, doc)
        return doc
      })
      loading.set(root, ready)
      return ready
    },
    view(root) {
      const doc = held.get(root)
      return doc === undefined ? null : { root, doc, session, live }
    },
    rootOfLane: lane => readLaneRecords(session).get(lane)?.root ?? null,
    docOfLane(lane) {
      const root = readLaneRecords(session).get(lane)?.root
      return root === undefined ? null : (held.get(root) ?? null)
    },
    laneDoc(lane) {
      const root = readLaneRecords(session).get(lane)?.root
      return root === undefined ? Promise.resolve(null) : this.root(root)
    },
    rootOfEntry(entry) {
      for (const r of readRoots(session).values())
        if (r.entry === entry) return r.root
      return null
    },
    async unload(root) {
      if (!held.delete(root)) return
      for (const listener of releasing) await listener(root)
      exchange.unload(rootDocId(root))
    },
    async destroy(root) {
      if (held.delete(root))
        for (const listener of releasing) await listener(root)
      exchange.destroy(rootDocId(root))
    },
    loaded: () => [...held.keys()],
    onOpened(listener) {
      for (const [root, doc] of held) listener(root, doc)
      listeners.push(listener)
    },
    onReleasing(listener) {
      releasing.push(listener)
    },
  }
}
