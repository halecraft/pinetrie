// session/person-doc — one of your own documents, written only by your tabs
// and relayed by the host to you alone. A write made before the host's copy
// has arrived can win over a later one from another of your devices, so a
// writer asks `ready()` first.

import { sync } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import { type Readable, readable, snapshotStore } from "./store.ts"

export interface PersonDoc<D, T> {
  readonly doc: D
  /** The document as `read` reads it, after every change. */
  readonly value: Readable<T>
  /** Whether the host's copy has reached this one. */
  ready(): boolean
  /** Called after each change to the document, and to its sync with the host. */
  onChange(listener: () => void): () => void
  dispose(): void
}

/** `doc` is from `exchange.get` with the id `personDocId` gives. */
export function personDoc<D extends object, T>(
  doc: D,
  host: string,
  read: (doc: D) => T,
): PersonDoc<D, T> {
  const value = snapshotStore<T>(read(doc))
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const unsubscribe = subscribe(doc, () => {
    value.set(read(doc))
    changed()
  })
  const unsubscribeSync = sync(doc).onPeerSyncChange(changed)
  return {
    doc,
    value: readable(value),
    ready: () => sync(doc).readyFor(p => p.peerId === host),
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      unsubscribe()
      unsubscribeSync()
      listeners.clear()
    },
  }
}
