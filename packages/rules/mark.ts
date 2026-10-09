// mark — a task's title (ADR-0045, ADR-0116).
//
// The record is a host-written `pinetrie.mark` value in the session, keyed by
// the task's id. The last write wins, since nobody types a title together
// (ADR-0023), and clearing a title deletes its record.

import {
  type AgentId,
  ERR,
  type MarkRecord,
  type Refusal,
  refused,
  type TaskId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, taskKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

// The shape only: the host is the session's one writer, and stores only
// titles `parseTitle` accepted, so the title rule is not repeated here.
const MarkSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: Type.String(),
  at: Type.Number(),
})

/** Each task's title, at the task's id. */
export const MARK: RecordSpec<MarkRecord, TaskId, "session"> = {
  namespace: "pinetrie.mark",
  home: "session",
  keyOf: r => r.task,
  encode: ({ task, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(MarkSchema, contents, taskKey(key), (r, task) => ({
      task,
      title: r.title,
      // A writer id always starts `w-` (`writerId`), so neither is read as the other.
      by: r.by as WriterId | AgentId,
      at: r.at,
    })),
}

type MarkPlan =
  | Refusal
  /** The title is already stored, or there is none to clear: nothing is written. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly record: MarkRecord }
  | { readonly kind: "remove"; readonly task: TaskId }

/** Decide a mark: set `task`'s title, or clear it with null. */
export function planMark(input: {
  readonly task: TaskId
  readonly title: string | null
  readonly by: WriterId | AgentId
  readonly now: number
  /** Every task the session holds. */
  readonly tasks: ReadonlySet<TaskId>
  readonly marks: ReadonlyMap<TaskId, MarkRecord>
}): MarkPlan {
  const { task, title } = input
  if (!input.tasks.has(task))
    return refused(ERR.UNKNOWN_TARGET, "no such task to title")
  const stored = input.marks.get(task)?.title ?? null
  if (stored === title) return { kind: "unchanged" }
  return title === null
    ? { kind: "remove", task }
    : {
        kind: "write",
        record: { task, title, by: input.by, at: input.now },
      }
}
