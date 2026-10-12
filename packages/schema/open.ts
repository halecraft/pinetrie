// schema/open — the tasks a person has open, in their order: a Yjs document
// per person, written only by that person's tabs.
//
// A task maps to an order key, not a place in a list: two devices reordering
// at once merge per task, and a list could hold a task twice.

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { isTaskId, type TaskId } from "@pinetrie/core"

/** Each open task's id to its order key. A closed task has no key. */
export const OpenDoc = yjs.bind(
  Schema.struct({ tasks: Schema.record(Schema.string()) }),
)

/** An open-tasks document, as the Exchange gives it. */
export type OpenDocHandle =
  typeof OpenDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** An open-tasks document on its own, with no Exchange: for tests. */
export const newOpenDoc = (): OpenDocHandle => createDoc(OpenDoc)

/** Each open task and its order key, as stored; a key that is no task is left out. */
export const readOpenKeys = (doc: OpenDocHandle): ReadonlyMap<TaskId, string> =>
  new Map(
    Object.entries(doc.tasks()).flatMap(([task, key]) =>
      isTaskId(task) ? [[task, key] as const] : [],
    ),
  )
