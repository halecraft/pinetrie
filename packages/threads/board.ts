// threads/board — the board: an edit to its workflow states, and a canvas in the
// archive.

import type { CanvasId, WorkflowStateId, WriterId } from "@pinetrie/core"

/**
 * What an open state may be marked: Topics, where a canvas starts, or
 * Active, where an agent's first work moves a topic.
 */
export type WorkflowMark = "topics" | "active"
export const WORKFLOW_MARKS: readonly WorkflowMark[] = ["topics", "active"]

/**
 * A change to the workflow. `before` is where a moved or added open state
 * goes, null for after every open state; `mark` moves that mark to `state`
 * from the state that held it.
 */
export type WorkflowEdit =
  | {
      readonly action: "add"
      readonly name: string
      readonly before: WorkflowStateId | null
    }
  | {
      readonly action: "rename"
      readonly state: WorkflowStateId
      readonly name: string
    }
  | {
      readonly action: "move"
      readonly state: WorkflowStateId
      readonly before: WorkflowStateId | null
    }
  | { readonly action: "remove"; readonly state: WorkflowStateId }
  | {
      readonly action: "mark"
      readonly state: WorkflowStateId
      readonly mark: WorkflowMark
    }
  | { readonly action: "unmark-active" }
export type WorkflowAction = WorkflowEdit["action"]
export const WORKFLOW_ACTIONS: readonly WorkflowAction[] = [
  "add",
  "rename",
  "move",
  "remove",
  "mark",
  "unmark-active",
]

/**
 * A canvas in the archive, derived from its place and never stored: who
 * moved it there, and when. Its readers ask only whether a canvas is archived,
 * and by whom.
 */
export interface ArchivedCanvas {
  readonly canvas: CanvasId
  readonly by: WriterId
  readonly at: number
}
