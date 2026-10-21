// rules/fixtures — test support: a thread's card as its opening makes it, and
// a workflow checked whole.
// Production code never imports it.

import {
  type CanvasId,
  rootIdFor,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type CardRecord,
  ROOT_ORIGIN,
  type ThreadCard,
  type WorkflowMark,
} from "@pinetrie/threads"
import { checkedWorkflow, type Workflow, type WorkflowState } from "./board.ts"
import { planThreadOpen } from "./canvas-index.ts"

/**
 * A workflow of `open` and `archive` (`checkedWorkflow`). With no mark given
 * on any state, the first is marked Topics and the second Active, as a new
 * session's are. Throws for one `checkedWorkflow` refuses.
 */
export function testWorkflow(
  open: readonly (WorkflowState & { readonly mark?: WorkflowMark | null })[],
  archive: WorkflowState,
): Workflow {
  const marked = open.some(s => s.mark !== undefined)
  const made = checkedWorkflow(
    open.map((s, i) => ({
      id: s.id,
      name: s.name,
      mark: marked
        ? (s.mark ?? null)
        : i === 0
          ? "topics"
          : i === 1
            ? "active"
            : null,
    })),
    archive,
  )
  if (made === undefined)
    throw new Error("not a workflow checkedWorkflow makes")
  return made
}

/** A thread's card as it first lands on `canvas`'s canvas: at its end. */
export function landedThreadCard(input: {
  readonly thread: ThreadId
  readonly canvas: CanvasId
  readonly by: WriterId
  readonly cards: readonly CardRecord[]
}): ThreadCard {
  const opened = planThreadOpen({
    thread: input.thread,
    origin: ROOT_ORIGIN,
    root: rootIdFor("01a0ffd2-0000-7000-8000-0000000000f0"),
    by: input.by,
    now: 0,
    placement: { kind: "after", canvas: input.canvas, parent: null },
    opens: null,
    cards: input.cards,
  })
  const made = opened.kind === "open" ? opened.steps.at(-1) : undefined
  if (made?.kind !== "write" || made.record.kind !== "thread")
    throw new Error(`a test's thread card was refused: ${input.thread}`)
  return made.record
}
