// open — a thread opened as its column opens (ADR-0126): a branch at an
// entry, or a new tab's new root in a new task. Its record and its card are
// written now, so it is on its task's canvas, can be asked and can be
// closed, before it holds an entry; its first send writes only that entry.
// Pure.

import {
  type BoardPlace,
  type CardRecord,
  type Intent,
  type MoveRefusal,
  type RootId,
  type TaskId,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  threadAt,
  type Workflow,
  type WriterId,
} from "@pinetrie/core"
import { planThreadOpen, type ThreadOpen } from "./task.ts"

/** A thread's opening as its column asks for it. */
export type OpenThread = Omit<Extract<Intent, { kind: "open-thread" }>, "kind">

export type OpenPlan =
  | Extract<ThreadOpen, { kind: "open" }>
  | {
      readonly kind: "refused"
      /**
       * `unknown`: a branch's entry is not in its root, or its task is not
       * the session's; `taken`: the thread's id names a thread already, or
       * a new tab's root or task is in use; or its card's make refused.
       */
      readonly why: "unknown" | "taken" | MoveRefusal
    }

/**
 * A thread opened by `sender` (ADR-0126). A branch at `at`, in a task the
 * session holds, its card just after the thread `at` is in on that task's
 * canvas (`planThreadOpen`); or, with `at` null, a new tab's: a new root's
 * first thread in a new task, which lands on the board in `state`. Refused
 * unless its id is new, and a branch's entry is in its root (`index`), or a
 * new tab's root and task are new. Pure.
 */
export function planOpenThread(input: {
  readonly open: OpenThread
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Every root the directory names. */
  readonly roots: ReadonlySet<RootId>
  /** Every task the session holds. */
  readonly tasks: ReadonlySet<TaskId>
  /** A branch's root's tree; null for a new tab's. */
  readonly index: TreeIndex | null
  readonly workflow: Workflow | null
  readonly board: ReadonlyMap<TaskId, BoardPlace>
  readonly now: number
}): OpenPlan {
  const { open, index } = input
  if (
    input.threads.has(open.thread) ||
    input.cards.some(c => c.id === open.thread) ||
    index?.firstOf.has(open.thread) === true
  )
    return { kind: "refused", why: "taken" }
  const base = {
    thread: open.thread,
    root: open.root,
    by: input.sender,
    now: input.now,
    cards: input.cards,
  }
  if (open.at === null) {
    if (input.roots.has(open.root) || input.tasks.has(open.task))
      return { kind: "refused", why: "taken" }
    const opened = planThreadOpen({
      ...base,
      origin: { kind: "root" },
      placement: { kind: "after", task: open.task, parent: null },
      opens: {
        state: open.state,
        workflow: input.workflow,
        board: input.board,
      },
    })
    return opened.kind === "open" ? opened : refusedBy(opened.code)
  }
  const parent = index === null ? null : threadAt(index, open.at)
  if (parent === null || !input.tasks.has(open.task))
    return { kind: "refused", why: "unknown" }
  const opened = planThreadOpen({
    ...base,
    origin: { kind: "fork", at: open.at, how: "branch" },
    placement: { kind: "after", task: open.task, parent },
    opens: null,
  })
  return opened.kind === "open" ? opened : refusedBy(opened.code)
}

const refusedBy = (why: MoveRefusal): OpenPlan => ({ kind: "refused", why })
