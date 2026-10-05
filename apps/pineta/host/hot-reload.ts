// host/hot-reload — Vite's hot updates, held while a lane working directly
// in a directory edits a file in it.
//
// Agents edit their own disks, so the page's code changes only by your hand,
// and hot reload stays on (ADR-0034). A lane working directly in your working
// copy may edit the client this host serves, mid-run: an update to a file
// inside a running direct lane's directory is held, and the run's end
// reloads the page once (ADR-0022's reason). Whether the project is Pineta
// does not come into it: Vite reports only the files it serves, so a lane
// working in another project holds nothing.

import { realpathSync } from "node:fs"
import { isWithin } from "@pineta/core"
import { readLaneRecords, readRunning } from "@pineta/reads"
import type { LiveDocHandle, SessionDocHandle } from "@pineta/schema"

export type HotReload = ReturnType<typeof hotReload>

/**
 * Whether an update to `file` waits: it is inside a directory a running
 * direct lane works in. Both are real paths, as Vite reports `file`.
 */
export function isHeld(file: string, directDirs: readonly string[]): boolean {
  return directDirs.some(dir => isWithin(file, dir))
}

/** The real path of each running direct lane's directory. */
function runningDirectDirs(
  session: SessionDocHandle,
  live: LiveDocHandle,
): string[] {
  return [...readLaneRecords(session).values()].flatMap(r =>
    r.work?.kind === "direct" && readRunning(live, r.lane)
      ? [realPath(r.work.dir)]
      : [],
  )
}

/** A missing directory holds no file Vite could report: its path will do. */
const realPath = (dir: string): string => {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/**
 * A Vite plugin that holds each hot update `isHeld` says waits, and a hook
 * that reloads the page once at a run's end, when none of the held files
 * waits any longer.
 */
export function hotReload(input: {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
}) {
  const dirs = () => runningDirectDirs(input.session, input.live)
  const held = new Set<string>()
  let reload = () => {}
  return {
    plugin: {
      name: "pineta:held-while-direct",
      handleHotUpdate({ file }: { readonly file: string }) {
        if (!isHeld(file, dirs())) return undefined
        held.add(file)
        return []
      },
    },
    attach(fullReload: () => void) {
      reload = fullReload
    },
    runEnded() {
      if (held.size === 0) return
      const now = dirs()
      if ([...held].some(file => isHeld(file, now))) return
      held.clear()
      reload()
    },
  }
}
