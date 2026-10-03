// host/directory — the directory of roots (ADR-0063): each root's `pineta.root`
// record, refreshed whenever its document's entries or values change, so
// what the tabs, the Archive tab, the inbox and the image sweep read of a
// root follows it without any of them opening it.
//
// A change queues one refresh per root, the documents' keeper's `once`
// (`root:<id>`): changes before it starts are absorbed by it. The refresh
// gathers the root's document (`readRootRecord`), and writes only a record
// that changed (`setIfChanged`), so a change to anything the record does not
// show writes nothing. A compaction is the keeper's `later`, so it runs after
// every refresh queued before it starts, and the records it compacts are
// current.

import { subscribe } from "@kyneta/schema"
import type { RootId } from "@pineta/core"
import { ROOT, setIfChanged } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readRootRecord, readRoots } from "@pineta/reads"
import type { RootDocHandle } from "@pineta/schema"
import { type Basics, failed, type HostKeeper } from "./basics.ts"

export interface Directory {
  /** Follow `root`'s document: called once, as the host opens it. */
  watch(root: RootId, doc: RootDocHandle): void
  /** Refresh `root`'s record: one `once` step per root on the keeper. */
  refresh(root: RootId): Promise<void>
}

export function createDirectory(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "log">
  readonly keeper: HostKeeper
  /** Read lazily: the agent is made after the documents are opened. */
  readonly agent: () => Pick<Agent, "writeValues">
}): Directory {
  const { basics, keeper } = deps

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

  // A failure is logged inside the step, once, however many changes it covered.
  const refresh = (root: RootId): Promise<void> =>
    keeper.once(`root:${root}`, () =>
      write(root).catch(failed(basics, "refreshing a root's record")),
    )

  return {
    watch(root, doc) {
      const changed = () => void refresh(root)
      subscribe(doc.entries, changed)
      subscribe(doc.values, changed)
    },
    refresh,
  }
}
