// session/open-threads — the sidebar: the canvases you have open, in your
// order, in your own document. Every write waits for `PersonDoc.ready`.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { CanvasId, WriterId } from "@pinetrie/core"
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
  /** The sidebar, in order. A canvas the directory lacks is still listed. */
  readonly canvases: Readable<readonly CanvasId[]>
  /** Put `canvas` before `before`, or at the end; a canvas already open moves there. */
  open(canvas: CanvasId, before: CanvasId | null): void
  /** `canvas` at the end of the sidebar, unless it is in it already. */
  ensure(canvas: CanvasId): void
  close(canvas: CanvasId): void
  /** The canvas the page shows, or null: the repair keeps it while it is archived. */
  here(canvas: CanvasId | null): void
  /** Repair against the archived canvases now: after a change to the session's records. */
  repair(): void
  dispose(): void
}

export function openThreads(
  exchange: Exchange,
  me: WriterId,
  host: string,
  /** The canvases archived now (`readArchived`). */
  archived: () => ReadonlySet<CanvasId>,
): OpenThreads {
  const own = personDoc(
    exchange.get(personDocId("open", me), OpenDoc),
    host,
    readOpenKeys,
  )
  const doc = own.doc
  let shown: CanvasId | null = null
  let lastKeys: ReadonlyMap<CanvasId, string> | null = null
  let lastList: readonly CanvasId[] = []

  const write = (writes: OpenWrites) => {
    if (!own.ready()) return
    if (writes.set.size === 0 && writes.delete.length === 0) return
    batch(doc, d => {
      for (const [canvas, key] of writes.set) d.canvases.set(canvas, key)
      for (const canvas of writes.delete) d.canvases.delete(canvas)
    })
  }
  const repair = () =>
    write(planOpenRepair(own.value.current(), archived(), shown))
  const unchanged = own.onChange(repair)

  return {
    canvases: {
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
    open: (canvas, before) =>
      write(placeInList(own.value.current(), canvas, before)),
    ensure(canvas) {
      if (!own.value.current().has(canvas))
        write(placeInList(own.value.current(), canvas, null))
    },
    close(canvas) {
      if (own.value.current().has(canvas))
        write({ set: new Map(), delete: [canvas] })
    },
    here(canvas) {
      if (canvas === shown) return
      shown = canvas
      repair()
    },
    repair,
    dispose() {
      unchanged()
      own.dispose()
    },
  }
}
