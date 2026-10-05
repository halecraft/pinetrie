// host/directory — the directory of roots (ADR-0063): each root's `pinetrie.root`
// record, refreshed whenever its document's entries or values change, so
// what your list, the board, the inbox and the image sweep read of a
// root follows it without any of them opening it.
//
// The directory follows every root the documents hold (`onOpened`), those
// opened before it started among them, and refreshes each as it starts to
// follow it. A refresh writes through the scribe, so it can start as soon
// as the scribe exists.
//
// A change queues one refresh per root, the documents' keeper's `once`
// (`root:<id>`): changes before it starts are absorbed by it. The refresh
// gathers the root's document (`readRootRecord`), and writes only a record
// that changed (`setIfChanged`), so a change to anything the record does not
// show writes nothing. A compaction is the keeper's `later`, so it runs after
// every refresh queued before it starts, and the records it compacts are
// current.

import { subscribe } from "@kyneta/schema"
import type { RootId } from "@pinetrie/core"
import type { Scribe } from "@pinetrie/pi"
import { readRootRecord, readRoots } from "@pinetrie/reads"
import { ROOT, setIfChanged } from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import { type Basics, failed, type HostKeeper } from "./basics.ts"

export function startDirectory(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "log">
  readonly keeper: HostKeeper
  readonly scribe: Pick<Scribe, "writeValues">
}): void {
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
    if (writes.length > 0) await deps.scribe.writeValues(writes)
  }

  // A failure is logged inside the step, once, however many changes it covered.
  const refresh = (root: RootId): Promise<void> =>
    keeper.once(`root:${root}`, () =>
      write(root).catch(failed(basics, "refreshing a root's record")),
    )

  function watch(root: RootId, doc: RootDocHandle): void {
    const changed = () => void refresh(root)
    subscribe(doc.entries, changed)
    subscribe(doc.values, changed)
    // A root no one writes in would keep the record it was stored with,
    // missing any field added since (`threads`, ADR-0077). Unchanged, the
    // refresh writes nothing.
    changed()
  }

  basics.docs.onOpened(watch)
}
