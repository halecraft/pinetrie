// threads/board — the board: an edit to its workflow states, and a canvas in the
// archive.

import type { CanvasId, WorkflowStateId, WriterId } from "@pinetrie/core"

/**
 * A change to the workflow. `state` names the state acted on (null to add
 * one); `name` is the new name (add, rename); `before` is where a moved or
 * added open state goes, null for after every open state.
 */
export interface WorkflowEdit {
  readonly action: WorkflowAction
  readonly state: WorkflowStateId | null
  readonly name: string
  readonly before: WorkflowStateId | null
}
export type WorkflowAction = "add" | "rename" | "move" | "remove"
export const WORKFLOW_ACTIONS: readonly WorkflowAction[] = [
  "add",
  "rename",
  "move",
  "remove",
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
