// host/watch-dir — one directory watched on the host (`@parcel/watcher`:
// FSEvents on the Mac, inotify on Linux): its events handed on once nothing
// has changed for a quiet window, and a dropped-events error at once, which
// the caller answers with a scan. The shared directories' watcher and your
// folder's both watch through it, so there is one debounce.

import watcher from "@parcel/watcher"

/** What a watched directory saw: changed paths (absolute), or events lost. */
export type DirChange =
  | {
      readonly kind: "events"
      readonly events: readonly {
        readonly path: string
        readonly type: "create" | "update" | "delete"
      }[]
    }
  | { readonly kind: "dropped" }

/**
 * Calls `fire` with what came in once `ms` passed with nothing more; at
 * once with 0. A drop is handed on at once, with what was held before it.
 */
export function quietWindow(
  ms: number,
  fire: (change: DirChange) => void,
): { push(change: DirChange): void; cancel(): void } {
  let held: Extract<DirChange, { kind: "events" }>["events"][number][] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const events = held
    held = []
    if (events.length > 0) fire({ kind: "events", events })
  }
  return {
    push(change) {
      if (change.kind === "dropped") {
        if (timer !== null) clearTimeout(timer)
        flush()
        fire(change)
        return
      }
      held.push(...change.events)
      if (ms === 0) return flush()
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flush, ms)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      held = []
    },
  }
}

/** `dir` watched, its changes handed to `onChange` after `quietMs` of quiet. */
export async function watchDir(input: {
  readonly dir: string
  readonly quietMs: number
  readonly onChange: (change: DirChange) => void
}): Promise<{ unsubscribe(): Promise<void> }> {
  const window = quietWindow(input.quietMs, input.onChange)
  const sub = await watcher.subscribe(input.dir, (error, events) => {
    // An error is events dropped: what changed is found by a scan.
    window.push(
      error === null ? { kind: "events", events } : { kind: "dropped" },
    )
  })
  return {
    async unsubscribe() {
      window.cancel()
      await sub.unsubscribe()
    },
  }
}
