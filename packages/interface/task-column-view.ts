// interface/task-column-view — the task column (ADR-0116): the task's own
// place on its canvas, first, outside the order. It shows the task's title,
// renamed there; its state on the board, changed there; who is here; the
// cards pinned to the task; and the canvas list its agents are told. Its
// title and its state are the same intents the sidebar and the board send.
// Folded, it shows the title and how many cards are pinned to the task.
// Pure: `TaskColumn` (`packages/web/task-column.tsx`) draws it.

import type {
  CardHistoryRecord,
  CardId,
  CardRecord,
  MarkRecord,
  NoteColumnId,
  NoteColumnRecord,
  TaskId,
  ThreadId,
  ThreadName,
  Workflow,
  WriterId,
} from "@pinetrie/core"
import { NEW_NOTES_TITLE, trashDeadline } from "@pinetrie/rules"
import { type ControlWords, who } from "./card-words.ts"
import { UNNAMED_THREAD } from "./folded-column-view.ts"
import { NO_TEXT, type TaskSummary } from "./root-label.ts"
import type { Reader } from "./send.ts"
import type { ThreadCardHead, ThreadMove } from "./thread-card.ts"

/** The task column, as drawn. */
export interface TaskColumnView {
  readonly task: TaskId
  readonly folded: boolean
  /** Its label: its title, else its first card's (`labelsOf`). */
  readonly label: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly titled: string | null
  /** The rename field's placeholder: its first message's line. */
  readonly placeholder: string
  /** The state it is in on the board, by name; null before the host placed it. */
  readonly state: string | null
  /** Move to ▸ each other state, as its thread card offers (`ThreadMove`). */
  readonly moves: readonly ThreadMove[]
  /** Nothing may be changed here: an archived task's column. */
  readonly readOnly: boolean
  /** The columns trashed from its canvas, newest first (`canvasTrash`). */
  readonly trash: readonly TrashRow[]
}

/** A column in the trash of a task's canvas, as its list draws it. */
export interface TrashRow {
  readonly card: ThreadId | NoteColumnId
  /** The thread's name, or the note column's title. */
  readonly title: string
  /** Who trashed it: its placer. */
  readonly by: WriterId
  /** Whole days until the sweep deletes it (`trashDeadline`), at least 0. */
  readonly deletesInDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The columns trashed from `task`'s canvas: each thread or note column in a
 * trash whose `left` is that canvas, the newest discard first. Pure.
 */
export function canvasTrash(input: {
  readonly cards: readonly CardRecord[]
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly task: TaskId
  readonly now: number
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly noteTitles: ReadonlyMap<NoteColumnId, NoteColumnRecord>
}): readonly TrashRow[] {
  const rows = input.cards.flatMap(c => {
    if (
      c.place.kind !== "trash" ||
      c.place.left.kind !== "canvas" ||
      c.place.left.task !== input.task
    )
      return []
    const deadline = trashDeadline(c.id, input.histories, input.now)
    const row = (card: ThreadId | NoteColumnId, title: string) => [
      {
        deadline,
        row: {
          card,
          title,
          by: c.placer,
          deletesInDays: Math.max(
            0,
            Math.ceil((deadline - input.now) / DAY_MS),
          ),
        },
      },
    ]
    switch (c.kind) {
      case "thread":
        return row(c.id, input.names.get(c.id) ?? UNNAMED_THREAD)
      case "note-column":
        return row(c.id, input.noteTitles.get(c.id)?.title ?? NEW_NOTES_TITLE)
      default:
        return []
    }
  })
  return rows
    .sort((a, b) =>
      b.deadline !== a.deadline
        ? b.deadline - a.deadline
        : a.row.card < b.row.card
          ? -1
          : 1,
    )
    .map(r => r.row)
}

/** A trash row's words: who trashed it, and when it is deleted. */
export const trashWords = (row: TrashRow, reader: Reader): string =>
  `${who(row.by, reader)} trashed it · deleted ${
    row.deletesInDays === 0
      ? "today"
      : row.deletesInDays === 1
        ? "in 1 day"
        : `in ${row.deletesInDays} days`
  }`

/** The trash list's heading, with how many it holds. */
export const trashHeading = (n: number): string => `trash · ${n}`

/** A trash row's button, and what it does. */
export const RESTORE_WORDS = {
  label: "restore",
  title: "bring it back where it was, for everyone",
} as const

/** The task column of `task`, from its thread card's head and its title's record. */
export function taskColumnView(input: {
  readonly task: TaskId
  readonly folded: boolean
  readonly head: ThreadCardHead | undefined
  readonly mark: MarkRecord | undefined
  readonly summary: TaskSummary | undefined
  readonly workflow: Workflow | null
  readonly archived: boolean
  /** Its canvas's trash (`canvasTrash`). */
  readonly trash: readonly TrashRow[]
}): TaskColumnView {
  const { head, workflow } = input
  const state =
    head?.state === null || head?.state === undefined || workflow === null
      ? null
      : ([...workflow.open, workflow.archive].find(s => s.id === head.state)
          ?.name ?? null)
  return {
    task: input.task,
    folded: input.folded,
    label: head?.label ?? NO_TEXT,
    titled: input.mark?.title ?? null,
    placeholder: input.summary?.line ?? NO_TEXT,
    state,
    moves: input.archived ? [] : (head?.moves ?? []),
    readOnly: input.archived,
    trash: input.trash,
  }
}

/** The task column's ⇤, which folds it to a strip. */
export const FOLD_TASK: ControlWords = {
  label: "⇤",
  title: "fold the task's column: only you see your folds",
  className: "fold",
}

/** The task column folded: its button, which unfolds it. */
export const UNFOLD_TASK: ControlWords = {
  label: "⇥",
  title:
    "the task: its title, its state, who is here, its pins and what its agents are told",
  className: "unfold",
}

/** The task column's rename, on its title. */
export const RENAME_TASK_TITLE = "rename this task, for everyone"

/** How many cards are pinned to the task, as its folded column says it. */
export const pinnedCountWords = (n: number): string | null =>
  n === 0 ? null : `${n} pinned`

/** The task column's pinned cards, empty: where a drop pins one. */
export const TASK_PINS_EMPTY =
  "drop a card here to pin it to the task: every thread's agent reads it"

/** The heading over the task's pinned cards. */
export const TASK_PINS_HEADING = "pinned to the task"

/** The heading over the canvas list the task's agents are told (ADR-0116). */
export const TASK_LIST_HEADING = "what its agents are told of the canvas"

/** What the state's line says: where the task is on the board. */
export const boardStateWords = (state: string | null): string =>
  state === null ? "not on the board yet" : `in ${state}`
