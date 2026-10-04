// session/store — a value that changes, and who hears it: the shape
// `useSyncExternalStore` reads.

export interface SnapshotStore<T> {
  current(): T
  /** A new value tells every listener; the same value tells none. */
  set(next: T): void
  /** `listener` hears every change; returns its unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** A value to read, and a way to hear it change: `useSyncExternalStore`'s shape. */
export type Readable<T> = Pick<SnapshotStore<T>, "current" | "subscribe">

/** `store`, for reading only. */
export const readable = <T>(store: Readable<T>): Readable<T> => ({
  current: store.current,
  subscribe: store.subscribe,
})

/**
 * One field of a store's value, read as its own value. `pick` must read, not
 * compute: a new value each call would never be the same snapshot.
 */
export const select = <T, F>(
  store: Readable<T>,
  pick: (value: T) => F,
): Readable<F> => ({
  current: () => pick(store.current()),
  subscribe: store.subscribe,
})

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
