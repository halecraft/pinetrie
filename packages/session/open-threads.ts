// session/open-threads — the sidebar: the roots you have open, in your order
// (ADR-0122), in your own document, the same on every device of yours.
// Every write waits for the host's copy (`PersonDoc.ready`, S101), and the
// list is repaired on every change: a root moved to the closed state leaves
// it (`planOpenRepair`). Runs in a browser and in Node alike.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { RootId, WriterId } from "@pinetrie/core"
import { personDocId } from "@pinetrie/protocol/writers"
import { OpenDoc, readOpenKeys } from "@pinetrie/schema"
import {
  type OpenWrites,
  orderOpen,
  placeInList,
  planOpenRepair,
} from "./open-repair.ts"
import { personDoc } from "./person-doc.ts"
import type { Readable } from "./store.ts"

export interface OpenThreads {
  /** The sidebar, in order. A root the directory lacks is still listed. */
  readonly roots: Readable<readonly RootId[]>
  /** Put `root` before `before`, or at the end; a root already open moves there. */
  open(root: RootId, before: RootId | null): void
  /** `root` at the end of the sidebar, unless it is in it already. */
  ensure(root: RootId): void
  close(root: RootId): void
  /** The root the page shows, or null: the repair keeps it while it is archived. */
  here(root: RootId | null): void
  /** Repair against the archived roots now: after a change to the session's records. */
  repair(): void
  dispose(): void
}

export function openThreads(
  exchange: Exchange,
  me: WriterId,
  host: string,
  /** The roots archived now (`readArchived`). */
  archived: () => ReadonlySet<RootId>,
): OpenThreads {
  const own = personDoc(
    exchange.get(personDocId("open", me), OpenDoc),
    host,
    readOpenKeys,
  )
  const doc = own.doc
  let shown: RootId | null = null
  let lastKeys: ReadonlyMap<RootId, string> | null = null
  let lastList: readonly RootId[] = []

  const write = (writes: OpenWrites) => {
    if (!own.ready()) return
    if (writes.set.size === 0 && writes.delete.length === 0) return
    batch(doc, d => {
      for (const [root, key] of writes.set) d.roots.set(root, key)
      for (const root of writes.delete) d.roots.delete(root)
    })
  }
  const repair = () =>
    write(planOpenRepair(own.value.current(), archived(), shown))
  const unchanged = own.onChange(repair)

  return {
    roots: {
      // The same list until the document changes: a page reads it in render.
      current() {
        const keys = own.value.current()
        if (keys !== lastKeys) {
          lastKeys = keys
          lastList = orderOpen(keys)
        }
        return lastList
      },
      subscribe: own.value.subscribe,
    },
    open: (root, before) =>
      write(placeInList(own.value.current(), root, before)),
    ensure(root) {
      if (!own.value.current().has(root))
        write(placeInList(own.value.current(), root, null))
    },
    close(root) {
      if (own.value.current().has(root))
        write({ set: new Map(), delete: [root] })
    },
    here(root) {
      if (root === shown) return
      shown = root
      repair()
    },
    repair,
    dispose() {
      unchanged()
      own.dispose()
    },
  }
}
