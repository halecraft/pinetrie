// interface/screen-memory — what a component knew of the screen when it was
// unmounted, kept for the page's life. A root shown again mounts its
// columns anew; this is how they come back as they were left.

export interface ScreenMemory<V> {
  get(key: string): V | undefined
  remember(key: string, value: V): void
}

/**
 * A memory over a `Map`, never pruned: its users keep small values under keys
 * that are not reused. A plain object, so a component may read it during
 * render, which a `useStable` handler must not be.
 */
export function screenMemory<V>(): ScreenMemory<V> {
  const kept = new Map<string, V>()
  return {
    get: key => kept.get(key),
    remember: (key, value) => {
      kept.set(key, value)
    },
  }
}
