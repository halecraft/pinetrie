// open — a thread opened as its column opens: a branch at an entry, a new
// tab's new root in a new task, or a new root in a task the session holds.

import {
  type CardRecord,
  type Intent,
  type MoveRefusal,
  type RootId,
  type TaskId,
  type ThreadId,
  type ThreadRecord,
  type ThreadStart,
  type TreeIndex,
  threadAt,
  type Workflow,
  type WriterId,
} from "@pinetrie/core"
import { planThreadOpen, type ThreadOpen } from "./task.ts"

/** A thread's opening as its column asks for it. */
export type OpenThread = Omit<Extract<Intent, { kind: "open-thread" }>, "kind">

/** How a thread starts, with what planning it needs: a branch's root's tree. */
export type GatheredStart =
  | (Extract<ThreadStart, { kind: "branch" }> & { readonly index: TreeIndex })
  | Exclude<ThreadStart, { kind: "branch" }>

export type OpenPlan =
  | Extract<ThreadOpen, { kind: "open" }>
  | {
      readonly kind: "refused"
      /**
       * `unknown`: a branch's entry is not in its root, or a task that should
       * be the session's is not; `taken`: the thread's id names a thread
       * already, or a new root or a new tab's task is in use; or its card's
       * make refused.
       */
      readonly why: "unknown" | "taken" | MoveRefusal
    }

/**
 * A thread opened by `sender`, refused unless its id is new. A branch at
 * an entry of its root's tree, in a task the session holds, its card just
 * after the thread the entry is in; a new tab's, a new root's first thread
 * in a new task, which lands on the board in its state; or a new root's
 * first thread in a task the session holds, its card where a card dropped
 * after `after` would land (`rankOnCanvas`).
 */
export function planOpenThread(input: {
  readonly open: Omit<OpenThread, "start">
  readonly start: GatheredStart
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Every root the directory names. */
  readonly roots: ReadonlySet<RootId>
  /** Every task the session holds. */
  readonly tasks: ReadonlySet<TaskId>
  readonly workflow: Workflow | null
  readonly now: number
}): OpenPlan {
  const { open, start } = input
  if (
    input.threads.has(open.thread) ||
    input.cards.some(c => c.id === open.thread) ||
    (start.kind === "branch" && start.index.firstOf.has(open.thread))
  )
    return { kind: "refused", why: "taken" }
  const base = {
    thread: open.thread,
    root: open.root,
    by: input.sender,
    now: input.now,
    cards: input.cards,
  }
  const held = input.tasks.has(open.task)
  switch (start.kind) {
    case "branch": {
      const parent = threadAt(start.index, start.at)
      if (parent === null || !held) return { kind: "refused", why: "unknown" }
      return settled(
        planThreadOpen({
          ...base,
          origin: { kind: "fork", at: start.at, how: "branch" },
          placement: { kind: "after", task: open.task, parent },
          opens: null,
        }),
      )
    }
    case "new-task":
      if (input.roots.has(open.root) || held)
        return { kind: "refused", why: "taken" }
      return settled(
        planThreadOpen({
          ...base,
          origin: { kind: "root" },
          placement: { kind: "after", task: open.task, parent: null },
          opens: { state: start.state, workflow: input.workflow },
        }),
      )
    case "new-root":
      if (input.roots.has(open.root)) return { kind: "refused", why: "taken" }
      if (!held) return { kind: "refused", why: "unknown" }
      return settled(
        planThreadOpen({
          ...base,
          origin: { kind: "root" },
          placement: {
            kind: "spot",
            to: { kind: "canvas-at", task: open.task, after: start.after },
          },
          opens: null,
        }),
      )
  }
}

const settled = (opened: ThreadOpen): OpenPlan =>
  opened.kind === "open" ? opened : { kind: "refused", why: opened.code }
