// host/directory — the directory of roots: each root's `pinetrie.root` record,
// refreshed whenever its document's entries, pi's values (a lane's tip) or the
// host's records (a mark) change, so what the sidebar, the board, the inbox and
// the image sweep read of a root follows it without any of them opening it.
//
// The directory follows every root the documents hold (`onOpened`), those
// opened before it started among them, and refreshes each as it starts to
// follow it. A refresh writes through the host's records, so it can start as
// soon as they exist.
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
import { readRootRecord, readRoots, readThreads } from "@pinetrie/reads"
import { ROOT, setIfChanged } from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import { type Basics, failed, type HostKeeper } from "./basics.ts"
import type { Records } from "./records.ts"

/**
 * The roots a starting host opens only to rebuild their directory record: named
 * by a thread's record, with no record that decodes in this build's shape
 * (`ROOT` is derived, so its shape changes with no migration), and not held
 * already, which a held root's refresh covers. In order, by id.
 */
export function planRebuild(input: {
  readonly named: Iterable<RootId>
  readonly recorded: ReadonlySet<RootId>
  readonly loaded: ReadonlySet<RootId>
}): readonly RootId[] {
  return [...new Set(input.named)]
    .filter(r => !input.recorded.has(r) && !input.loaded.has(r))
    .sort()
}

export function startDirectory(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "log">
  readonly keeper: HostKeeper
  readonly records: Pick<Records, "writeValues">
}): void {
  const { basics, keeper } = deps
  /** Each followed root's unsubscribes, dropped as the root is let go. */
  const following = new Map<RootId, readonly (() => void)[]>()

  async function write(root: RootId): Promise<void> {
    const view = basics.docs.view(root)
    if (view === null) return
    const record = readRootRecord(root, view.doc)
    const writes = setIfChanged(
      ROOT,
      record,
      readRoots(basics.session).get(root),
    )
    if (writes.length > 0) await deps.records.writeValues(writes)
  }

  // A failure is logged inside the step, once, however many changes it covered.
  const refresh = (root: RootId): Promise<void> =>
    keeper.once(`root:${root}`, () =>
      write(root).catch(failed(basics, "refreshing a root's record")),
    )

  function watch(root: RootId, doc: RootDocHandle): void {
    const changed = () => void refresh(root)
    following.set(root, [
      subscribe(doc.entries, changed),
      subscribe(doc.values, changed),
      subscribe(doc.records, changed),
    ])
    // A root no one writes in would keep the record it was stored with,
    // missing any field added since. Unchanged, the refresh writes nothing.
    changed()
  }

  basics.docs.onOpened(watch)
  basics.docs.onReleasing(async root => {
    for (const stop of following.get(root) ?? []) stop()
    following.delete(root)
  })

  // Every root no held document refreshes whose record is stale: opened,
  // its record written once, and let go again (an archived task's root).
  const stale = planRebuild({
    named: [...readThreads(basics.session).values()].map(t => t.root),
    recorded: new Set(readRoots(basics.session).keys()),
    loaded: new Set(basics.docs.loaded()),
  })
  void (async () => {
    for (const root of stale) {
      await basics.docs.root(root)
      await refresh(root)
      await basics.docs.unload(root)
    }
    if (stale.length > 0)
      basics.log(`[host] rebuilt ${stale.length} roots' directory records`)
  })().catch(failed(basics, "rebuilding the directory"))
}
