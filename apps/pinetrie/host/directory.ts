// host/directory — the directory of roots: each root's `pinetrie.root` record,
// refreshed whenever its document's entries, pi's values (a lane's tip) or the
// host's records (a mark) change, so what the sidebar, the board, the inbox and
// the image sweep read of a root follows it without any of them opening it.
//
// The directory follows every root loaded (`onOpened`), those loaded before
// it started among them, and refreshes each as it starts to follow it, and
// once more as the upkeep lets it go, so what changed after the last refresh
// is in the record. A refresh writes through the host's records, so it can
// start as soon as they exist.
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
import type { Roots } from "./roots.ts"

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
  readonly basics: Pick<Basics, "session" | "log">
  readonly keeper: HostKeeper
  readonly records: Pick<Records, "writeValues">
  readonly roots: Pick<Roots, "onOpened" | "onReleasing" | "loaded">
}): void {
  const { basics, keeper, roots } = deps
  /** Each followed root's document and unsubscribes, dropped as the root is let go. */
  const following = new Map<
    RootId,
    { readonly doc: RootDocHandle; readonly stops: readonly (() => void)[] }
  >()

  async function write(root: RootId): Promise<void> {
    const doc = following.get(root)?.doc
    if (doc === undefined) return
    const record = readRootRecord(root, doc)
    const stored = readRoots(basics.session).get(root)
    // A root with no message has not started: a step may load a tab's new
    // root before its first send, and a record now would make that send
    // find its id in use.
    if (record.entry === null && stored === undefined) return
    const writes = setIfChanged(ROOT, record, stored)
    if (writes.length > 0) await deps.records.writeValues(writes)
  }

  // A failure is logged inside the step, once, however many changes it covered.
  const refresh = (root: RootId): Promise<void> =>
    keeper.once(`root:${root}`, () =>
      write(root).catch(failed(basics, "refreshing a root's record")),
    )

  function watch(root: RootId, doc: RootDocHandle): void {
    const changed = () => void refresh(root)
    following.set(root, {
      doc,
      stops: [
        subscribe(doc.entries, changed),
        subscribe(doc.values, changed),
        subscribe(doc.records, changed),
      ],
    })
    // A root no one writes in would keep the record it was stored with,
    // missing any field added since. Unchanged, the refresh writes nothing.
    changed()
  }

  roots.onOpened(watch)
  // Let go: written once more, in the upkeep's step, from the document as it
  // leaves; destroyed: its record went with it, so nothing is written.
  roots.onReleasing(async (root, why) => {
    for (const stop of following.get(root)?.stops ?? []) stop()
    if (why === "unload")
      await write(root).catch(failed(basics, "refreshing a root's record"))
    following.delete(root)
  })

  // Every root not loaded whose record is stale: loaded in a step, which
  // its first refresh follows, and let go by the upkeep (an archived canvas's
  // root).
  const stale = planRebuild({
    named: [...readThreads(basics.session).values()].map(t => t.root),
    recorded: new Set(readRoots(basics.session).keys()),
    loaded: new Set(roots.loaded()),
  })
  if (stale.length > 0)
    keeper
      .run(async step => {
        for (const root of stale) await step.root(root)
        basics.log(`[host] rebuilt ${stale.length} roots' directory records`)
      })
      .catch(failed(basics, "rebuilding the directory"))
}
