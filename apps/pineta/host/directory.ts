// host/directory — the directory of roots (ADR-0063): each root's `pineta.root`
// record, refreshed whenever its document's entries or values change, so
// what the tabs, the Archive tab, the inbox and the image sweep read of a
// root follows it without any of them opening it.
//
// A change queues one refresh per root on the host's `Serial`; changes
// before it starts are absorbed by it. The refresh gathers the root's
// document (`readRootRecord`), and writes only a record that changed
// (`setIfChanged`), so a change to anything the record does not show writes
// nothing.

import { subscribe } from "@kyneta/schema"
import type { RootId } from "@pineta/core"
import { ROOT, setIfChanged } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readRootRecord, readRoots } from "@pineta/reads"
import type { RootDocHandle } from "@pineta/schema"
import { type Basics, failed } from "./basics.ts"
import type { Serial } from "./queue.ts"

export interface Directory {
  /** Follow `root`'s document: called once, as the host opens it. */
  watch(root: RootId, doc: RootDocHandle): void
  /** Refresh `root`'s record, as one step queued on the host's `Serial`. */
  refresh(root: RootId): Promise<void>
  /**
   * Write every queued refresh now, inside the caller's step: a compaction
   * calls this first, so the records it compacts are current, and no refresh
   * behind it writes again.
   */
  flush(): Promise<void>
}

export function createDirectory(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "log">
  readonly serial: Serial
  /** Read lazily: the agent is made after the documents are opened. */
  readonly agent: () => Pick<Agent, "writeValues">
}): Directory {
  const { basics, serial } = deps
  const queued = new Set<RootId>()

  async function write(root: RootId): Promise<void> {
    const view = basics.docs.view(root)
    if (view === null) return
    const record = readRootRecord(root, view.doc)
    const writes = setIfChanged(
      ROOT,
      record,
      readRoots(basics.session).get(root),
    )
    if (writes.length > 0) await deps.agent().writeValues(writes)
  }

  const refresh = (root: RootId): Promise<void> => {
    if (queued.has(root)) return Promise.resolve()
    queued.add(root)
    return serial
      .run(async () => {
        // Flushed already, by a compaction's step.
        if (!queued.delete(root)) return
        await write(root)
      })
      .catch(failed(basics, "refreshing a root's record"))
  }

  return {
    watch(root, doc) {
      const changed = () => void refresh(root)
      subscribe(doc.entries, changed)
      subscribe(doc.values, changed)
    },
    refresh,
    async flush() {
      const roots = [...queued]
      queued.clear()
      for (const root of roots) await write(root)
    },
  }
}
