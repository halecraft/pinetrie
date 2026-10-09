// task-pinned — the cards pinned to a task that a run reads (ADR-0116).
//
// A task's cards entry is a history message (`history.ts`) of its own, beside
// a thread's (`pinned.ts`), so neither's stored shape changes and each is
// restated only when it changes: the host plans one when a run starts and
// the task's pinned cards differ from those the model last read on the path
// (`taskPinnedInView`), compared as a thread's are (`pinnedDiff`). It
// restates every card pinned to the task now, and names each unpinned since.

import {
  firstLine,
  type PinnedCardRead,
  type TaskId,
  type TaskPinnedView,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { CardIdSchema, List, TaskIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { attribute, neutral, pinnedDiff, RETIRED_LINE } from "./pinned.ts"

export const TASK_PINNED_TYPE = "pinetrie.task-pinned"

const TaskPinnedDetailsSchema = Type.Object({
  task: TaskIdSchema,
  cards: List(
    Type.Object({
      id: CardIdSchema,
      text: Type.String(),
      by: WriterIdSchema,
    }),
  ),
  retired: List(
    Type.Object({
      id: CardIdSchema,
      line: Type.String(),
    }),
  ),
})

/** The column draws its own marker for a task's cards entry, not pi's message. */
export const TASK_PINNED = historyMessage(
  TASK_PINNED_TYPE,
  TaskPinnedDetailsSchema,
  false,
)

/** The pi `CustomMessage` a task's cards entry is stored as. */
export type TaskPinnedMessage = HistoryMessage<
  typeof TASK_PINNED_TYPE,
  TaskPinnedView
>

/** A stored message -> the task's cards it says a run read, or undefined. */
export const decodeTaskPinned = (
  message: unknown,
): TaskPinnedView | undefined => TASK_PINNED.decode(message)

/** What the model reads of `view`, each card named by its owner's display name. */
export function taskPinnedContent(
  view: TaskPinnedView,
  nameOf: (writer: WriterId) => string,
): string {
  const cards =
    view.cards.length === 0
      ? "There are no cards pinned to the task now.\n"
      : view.cards
          .map(
            c =>
              `<card by="${attribute(nameOf(c.by))}">\n${neutral(c.text)}\n</card>\n`,
          )
          .join("\n")
  const retired = view.retired
    .map(r => `No longer applies: "${neutral(r.line)}"\n`)
    .join("")
  return (
    "<task-pinned-cards>\n" +
    "The cards pinned to the whole task, as they are now. They replace any earlier task-pinned cards.\n\n" +
    cards +
    (retired === "" ? "" : `\n${retired}`) +
    "</task-pinned-cards>"
  )
}

/** The task's cards entry for `view`. */
export const encodeTaskPinned = (
  view: TaskPinnedView,
  nameOf: (writer: WriterId) => string,
  timestamp: number,
): TaskPinnedMessage =>
  TASK_PINNED.encode(
    {
      task: view.task,
      cards: view.cards.map(c => ({ id: c.id, text: c.text, by: c.by })),
      retired: view.retired.map(r => ({ id: r.id, line: r.line })),
    },
    taskPinnedContent(view, nameOf),
    timestamp,
  )

/**
 * The cards pinned to `task` a run reads, or null when the model already
 * reads them as they are: every card read, none retired, the same order.
 * Cards read for another task (a thread moved since, ADR-0117) are all
 * retired. Pure.
 */
export function planTaskPinnedRead(input: {
  readonly inView: TaskPinnedView | null
  readonly now: readonly PinnedCardRead[]
  readonly task: TaskId
}): TaskPinnedView | null {
  const inView = input.inView?.task === input.task ? input.inView : null
  const diff = pinnedDiff(inView, input.now)
  // What another task's entry said no longer applies here.
  const elsewhere =
    input.inView !== null && inView === null
      ? input.inView.cards.map(c => ({
          id: c.id,
          line: firstLine(c.text, RETIRED_LINE),
        }))
      : []
  const unchanged =
    [...diff.status.values()].every(s => s === "read") &&
    diff.retired.length === 0 &&
    elsewhere.length === 0 &&
    !diff.reordered
  if (unchanged) return null
  // A first entry with nothing pinned and nothing to retire says nothing.
  if (
    input.now.length === 0 &&
    diff.retired.length === 0 &&
    elsewhere.length === 0
  )
    return null
  return {
    task: input.task,
    cards: input.now,
    retired: [...diff.retired, ...elsewhere],
  }
}
