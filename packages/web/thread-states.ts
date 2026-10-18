// web/thread-states — the board's open states, where a note or your message can
// start a thread from its ⋯. `App` provides them from the workflow; a card's
// editor reads them for its Move to ▸ items.

import type { WorkflowState } from "@pinetrie/rules"
import { createContext, useContext } from "react"

/** The workflow's open states, in order; none before the workflow arrives. */
export const ThreadStates = createContext<readonly WorkflowState[]>([])

export const useThreadStates = (): readonly WorkflowState[] =>
  useContext(ThreadStates)
