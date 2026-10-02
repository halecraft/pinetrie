// client/store — a value that changes, and who hears it: the shape
// `useSyncExternalStore` reads.

export interface SnapshotStore<T> {
  current(): T
  /** A new value tells every listener; the same value tells none. */
  set(next: T): void
  /** `listener` hears every change; returns its unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** A store holding `initial`. */
export function snapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    current: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
