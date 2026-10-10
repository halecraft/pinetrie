// rules/fixtures — test support: a thread's card as its first message makes
// it (`planThreadCard`). Rules' tests use it, and other packages' tests as
// `@pinetrie/rules/fixtures`; production code never imports it.

import type {
  CardRecord,
  TaskId,
  ThreadCard,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { planThreadCard } from "./task.ts"

/** A thread's card as it first lands on `task`'s canvas: at its end. */
export function threadCardOf(input: {
  readonly thread: ThreadId
  readonly task: TaskId
  readonly by: WriterId
  readonly cards: readonly CardRecord[]
}): ThreadCard {
  const { step } = planThreadCard({ ...input, parent: null })
  if (step.kind !== "write" || step.record.kind !== "thread")
    throw new Error(`a test's thread card was refused: ${input.thread}`)
  return step.record
}
