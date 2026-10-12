// rules/fixtures — test support: a thread's card as its opening makes it.
// Production code never imports it.

import {
  type CardRecord,
  ROOT_ORIGIN,
  rootIdFor,
  type TaskId,
  type ThreadCard,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { planThreadOpen } from "./task.ts"

/** A thread's card as it first lands on `task`'s canvas: at its end. */
export function threadCardOf(input: {
  readonly thread: ThreadId
  readonly task: TaskId
  readonly by: WriterId
  readonly cards: readonly CardRecord[]
}): ThreadCard {
  const opened = planThreadOpen({
    thread: input.thread,
    origin: ROOT_ORIGIN,
    root: rootIdFor("01a0ffd2-0000-7000-8000-0000000000f0"),
    by: input.by,
    now: 0,
    placement: { kind: "after", task: input.task, parent: null },
    opens: null,
    cards: input.cards,
  })
  const made = opened.kind === "open" ? opened.steps.at(-1) : undefined
  if (made?.kind !== "write" || made.record.kind !== "thread")
    throw new Error(`a test's thread card was refused: ${input.thread}`)
  return made.record
}
