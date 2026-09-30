// host/hot-reload — Vite's hot updates, held while a lane works directly in
// the working copy this host serves.
//
// Agents edit their own disks, so the page's code changes only by your hand,
// and hot reload stays on (ADR-0034). A lane working directly in your working
// copy edits the client this host serves, mid-run: while one runs, updates
// are held, and its end reloads the page once (ADR-0022's reason).

import path from "node:path"
import type { ProjectRecord } from "@pineta/core"
import { readLaneRecords, readLanes, readTreeIndex } from "@pineta/reads"
import type { SessionDocHandle } from "@pineta/schema"

export type HotReload = ReturnType<typeof pausedWhile>

/** Hot reload, paused while a direct lane inside the project runs. */
export function hotReload(input: {
  readonly doc: SessionDocHandle
  readonly project: () => ProjectRecord | null
}): HotReload {
  const { doc } = input
  return pausedWhile(() => {
    const project = input.project()
    if (project === null) return false
    const records = readLaneRecords(doc)
    return readLanes(doc, readTreeIndex(doc)).some(l => {
      const w = l.running ? records.get(l.name)?.work : undefined
      return w?.kind === "direct" && isWithin(w.dir, project.root)
    })
  })
}

/** Whether `dir` is `root` or inside it. */
const isWithin = (dir: string, root: string): boolean => {
  const rel = path.relative(root, dir)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * A Vite plugin that holds hot updates while `paused()` says so, and a hook
 * that reloads the page once when the pause ends: a run's end is the moment.
 */
function pausedWhile(paused: () => boolean) {
  let held = false
  let reload = () => {}
  return {
    plugin: {
      name: "pineta:paused-while-direct",
      handleHotUpdate() {
        if (!paused()) return undefined
        held = true
        return []
      },
    },
    attach(fullReload: () => void) {
      reload = fullReload
    },
    runEnded() {
      if (held && !paused()) {
        held = false
        reload()
      }
    },
  }
}
