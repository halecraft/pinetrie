// core/board — the board: its workflow states, an edit to them, and a canvas
// in the archive.

import type { CanvasId, WorkflowStateId, WriterId } from "./ids.ts"

/** A workflow state: a column of the board. */
export interface WorkflowState {
  readonly id: WorkflowStateId
  readonly name: string
}

/**
 * The session's workflow: a host-written `pinetrie.workflow` singleton. The
 * open states in board order, then the archive, which is always there and
 * always last: a root in it is archived.
 */
export interface Workflow {
  readonly open: readonly WorkflowState[]
  readonly archive: WorkflowState
}

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
