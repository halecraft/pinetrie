// session/open-threads — the sidebar: the tasks you have open, in your
// order, in your own document. Every write waits for `PersonDoc.ready`.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { TaskId, WriterId } from "@pinetrie/core"
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
  /** The sidebar, in order. A task the directory lacks is still listed. */
  readonly tasks: Readable<readonly TaskId[]>
  /** Put `task` before `before`, or at the end; a task already open moves there. */
  open(task: TaskId, before: TaskId | null): void
  /** `task` at the end of the sidebar, unless it is in it already. */
  ensure(task: TaskId): void
  close(task: TaskId): void
  /** The task the page shows, or null: the repair keeps it while it is archived. */
  here(task: TaskId | null): void
  /** Repair against the archived tasks now: after a change to the session's records. */
  repair(): void
  dispose(): void
}

export function openThreads(
  exchange: Exchange,
  me: WriterId,
  host: string,
  /** The tasks archived now (`readArchived`). */
  archived: () => ReadonlySet<TaskId>,
): OpenThreads {
  const own = personDoc(
    exchange.get(personDocId("open", me), OpenDoc),
    host,
    readOpenKeys,
  )
  const doc = own.doc
  let shown: TaskId | null = null
  let lastKeys: ReadonlyMap<TaskId, string> | null = null
  let lastList: readonly TaskId[] = []

  const write = (writes: OpenWrites) => {
    if (!own.ready()) return
    if (writes.set.size === 0 && writes.delete.length === 0) return
    batch(doc, d => {
      for (const [task, key] of writes.set) d.tasks.set(task, key)
      for (const task of writes.delete) d.tasks.delete(task)
    })
  }
  const repair = () =>
    write(planOpenRepair(own.value.current(), archived(), shown))
  const unchanged = own.onChange(repair)

  return {
    tasks: {
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
    open: (task, before) =>
      write(placeInList(own.value.current(), task, before)),
    ensure(task) {
      if (!own.value.current().has(task))
        write(placeInList(own.value.current(), task, null))
    },
    close(task) {
      if (own.value.current().has(task))
        write({ set: new Map(), delete: [task] })
    },
    here(task) {
      if (task === shown) return
      shown = task
      repair()
    },
    repair,
    dispose() {
      unchanged()
      own.dispose()
    },
  }
}
