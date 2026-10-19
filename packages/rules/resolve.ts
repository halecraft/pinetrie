// resolve — a person's choice of a conflict's version from the page,
// decided before anything is read: only a lane of the host's own has
// conflicts to close, and never while its agent runs, whose next write could
// land under the choice.

import { ERR, type ErrCode } from "@pinetrie/core"

/** Whether a person's choice of a conflict's version goes ahead, or why not. */
type ResolveCommand =
  | { readonly kind: "go" }
  | { readonly kind: "refused"; readonly code: ErrCode }

export function planResolveCommand(input: {
  /** Whether the lane is the host's own: it has a copy, and so conflicts. */
  readonly own: boolean
  readonly running: boolean
}): ResolveCommand {
  if (!input.own) return { kind: "refused", code: ERR.NOT_OWN_COPY }
  if (input.running) return { kind: "refused", code: ERR.THREAD_RUNNING }
  return { kind: "go" }
}
