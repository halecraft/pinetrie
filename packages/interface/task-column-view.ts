// interface/task-column-view — the task column (ADR-0116): the task's own
// place on its canvas, first, outside the order. It shows the task's title,
// renamed there; its state on the board, changed there; who is here; the
// cards pinned to the task; and the canvas list its agents are told. Its
// title and its state are the same intents the sidebar and the board send.
// Folded, it shows the title and how many cards are pinned to the task.
// Pure: `TaskColumn` (`packages/web/task-column.tsx`) draws it.

import type { MarkRecord, TaskId, Workflow } from "@pinetrie/core"
import type { ControlWords } from "./card-words.ts"
import { NO_TEXT, type TaskSummary } from "./root-label.ts"
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
}

/** The task column of `task`, from its thread card's head and its title's record. */
export function taskColumnView(input: {
  readonly task: TaskId
  readonly folded: boolean
  readonly head: ThreadCardHead | undefined
  readonly mark: MarkRecord | undefined
  readonly summary: TaskSummary | undefined
  readonly workflow: Workflow | null
  readonly archived: boolean
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
