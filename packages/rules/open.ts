// open — a thread opened before its first send: as its column opens, a branch
// at an entry, a new canvas's new root, or a new root in a canvas the
// session holds; or one branch of a proposal's press (`planBranchOpen`).

import {
  type CanvasId,
  type CardRecord,
  type EntryId,
  entryThread,
  type Intent,
  type MoveRefusal,
  type ProposalBranch,
  type RootId,
  type ThreadId,
  type ThreadRecord,
  type ThreadStart,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { Workflow } from "./board.ts"
import { planThreadOpen, type ThreadOpen } from "./canvas-index.ts"

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
       * `unknown`: a branch's entry is not in its root, or a canvas that should
       * be the session's is not; `taken`: the thread's id names a thread
       * already, or a new root or a new canvas's id is in use; or its card's
       * make refused.
       */
      readonly why: "unknown" | "taken" | MoveRefusal
    }

/**
 * A thread opened by `sender`, refused unless its id is new. A branch at
 * an entry of its root's tree, in a canvas the session holds, its card just
 * after the thread the entry is in (`planBranchOpen`); a new canvas's, a new
 * root's first thread in a new canvas, which lands on the board in its state;
 * or a new root's first thread in a canvas the session holds, its card where a
 * card dropped after `after` would land (`rankOnCanvas`).
 */
export function planOpenThread(input: {
  readonly open: Omit<OpenThread, "start">
  readonly start: GatheredStart
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Every root the directory names. */
  readonly roots: ReadonlySet<RootId>
  /** Every canvas the session holds. */
  readonly canvases: ReadonlySet<CanvasId>
  readonly workflow: Workflow | null
  readonly now: number
}): OpenPlan {
  const { open, start } = input
  if (start.kind === "branch")
    return planBranchOpen({
      thread: open.thread,
      root: open.root,
      canvas: open.canvas,
      at: start.at,
      after: null,
      proposal: null,
      index: start.index,
      sender: input.sender,
      cards: input.cards,
      threads: input.threads,
      canvases: input.canvases,
      now: input.now,
    })
  if (isTaken(open.thread, input.cards, input.threads, null))
    return { kind: "refused", why: "taken" }
  const base = {
    thread: open.thread,
    root: open.root,
    by: input.sender,
    now: input.now,
    cards: input.cards,
  }
  const held = input.canvases.has(open.canvas)
  switch (start.kind) {
    case "new-canvas":
      if (input.roots.has(open.root) || held)
        return { kind: "refused", why: "taken" }
      return settled(
        planThreadOpen({
          ...base,
          origin: { kind: "root" },
          placement: { kind: "after", canvas: open.canvas, parent: null },
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
            to: { kind: "canvas-at", canvas: open.canvas, after: start.after },
          },
          opens: null,
        }),
      )
  }
}

/** Whether `thread` names a thread already: a record, a card, or an entry. */
const isTaken = (
  thread: ThreadId,
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  index: TreeIndex | null,
): boolean =>
  threads.has(thread) ||
  cards.some(c => c.id === thread) ||
  (index?.firstOf.has(thread) ?? false)

/**
 * A branch at `at` opened by `sender`, refused unless its id is new, `at`
 * is in its root's tree and the canvas is the session's. Its card goes just
 * after `after`'s, or with null after the thread `at` is in; a proposal's
 * press names the branch before, so its branches keep the proposal's order.
 * A branch from a proposal records it in its origin.
 */
export function planBranchOpen(input: {
  readonly thread: ThreadId
  readonly root: RootId
  readonly canvas: CanvasId
  readonly at: EntryId
  readonly after: ThreadId | null
  readonly proposal: ProposalBranch | null
  /** The root's tree. */
  readonly index: TreeIndex
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Every canvas the session holds. */
  readonly canvases: ReadonlySet<CanvasId>
  readonly now: number
}): OpenPlan {
  const { thread, at, index } = input
  if (isTaken(thread, input.cards, input.threads, index))
    return { kind: "refused", why: "taken" }
  const parent = entryThread(index, at)
  if (parent === null || !input.canvases.has(input.canvas))
    return { kind: "refused", why: "unknown" }
  return settled(
    planThreadOpen({
      thread,
      root: input.root,
      by: input.sender,
      now: input.now,
      cards: input.cards,
      origin:
        input.proposal === null
          ? { kind: "fork", at, how: "branch" }
          : { kind: "fork", at, how: "branch", proposal: input.proposal },
      placement: {
        kind: "after",
        canvas: input.canvas,
        parent: input.after ?? parent,
      },
      opens: null,
    }),
  )
}

const settled = (opened: ThreadOpen): OpenPlan =>
  opened.kind === "open" ? opened : { kind: "refused", why: opened.code }
