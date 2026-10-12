// mark — a task's title, and the one plan for titling a task or a note column.

import {
  type AgentId,
  ERR,
  type MarkRecord,
  type MarkTarget,
  type NoteColumnId,
  type NoteColumnRecord,
  type Refusal,
  refused,
  type TaskId,
  THE_AGENT,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, taskKey } from "./decode.ts"
import { NOTE_COLUMN } from "./note-column.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

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

const isAgent = (by: WriterId | AgentId): by is AgentId => by === THE_AGENT

type MarkPlan =
  | Refusal
  /** The title is already stored, or there is none to clear: nothing is written. */
  | { readonly kind: "unchanged" }
  /** The title's record written, or deleted to clear it. */
  | { readonly kind: "writes"; readonly writes: readonly ValueWrite[] }

/**
 * Decide a mark: set a task's or a note column's
 * title, or clear it with null. Each title is in its own record: a task's in
 * `MARK`, a note column's in `NOTE_COLUMN`, which only a person sets.
 */
export function planMark(input: {
  readonly of: MarkTarget
  readonly title: string | null
  readonly by: WriterId | AgentId
  readonly now: number
  /** Every task the session holds. */
  readonly tasks: ReadonlySet<TaskId>
  readonly marks: ReadonlyMap<TaskId, MarkRecord>
  /** Every note column on a canvas. */
  readonly columns: ReadonlySet<NoteColumnId>
  readonly columnTitles: ReadonlyMap<NoteColumnId, NoteColumnRecord>
}): MarkPlan {
  const { of, title, by, now } = input
  switch (of.kind) {
    case "task": {
      const { task } = of
      if (!input.tasks.has(task))
        return refused(ERR.UNKNOWN_TARGET, "no such task to title")
      const stored = input.marks.get(task)?.title ?? null
      if (stored === title) return { kind: "unchanged" }
      return {
        kind: "writes",
        writes: [
          title === null
            ? deleteRecord(MARK, task)
            : setRecord(MARK, { task, title, by, at: now }),
        ],
      }
    }
    case "note-column": {
      const { column } = of
      if (!input.columns.has(column) || isAgent(by))
        return refused(ERR.UNKNOWN_TARGET, "no such note column to title")
      const stored = input.columnTitles.get(column)?.title ?? null
      if (stored === title) return { kind: "unchanged" }
      return {
        kind: "writes",
        writes: [
          title === null
            ? deleteRecord(NOTE_COLUMN, column)
            : setRecord(NOTE_COLUMN, { column, title, by, at: now }),
        ],
      }
    }
  }
}
