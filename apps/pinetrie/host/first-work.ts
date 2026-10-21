// host/first-work — a canvas moved from Topics to Active as an agent's run
// starts in one of its threads, once: the board's own move, written as the
// host's change.

import type { ThreadId } from "@pinetrie/core"
import { readPlaces, readWorkflow } from "@pinetrie/reads"
import { planMoveToActive } from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import type { Places } from "./places.ts"

/**
 * Move `lane`'s canvas to the end of Active if an agent's first work is
 * starting in it (`planMoveToActive`). Called as a run begins, in the step
 * that starts it, so the plan reads the places as that step left them, and
 * nothing is written between the plan and the change, whose body a host
 * change runs at once. A run that moves nothing opens no change. As the
 * host's change it leaves no trace and enters nobody's stack of moves.
 */
export function moveCanvasToActive(
  deps: {
    readonly basics: Pick<Basics, "session" | "places">
    readonly places: Places
  },
  lane: ThreadId,
): Promise<void> {
  const steps = planMoveToActive({
    workflow: readWorkflow(deps.basics.session),
    cards: readPlaces(deps.basics.places),
    thread: lane,
  })
  if (steps.length === 0) return Promise.resolve()
  return deps.places
    .change({ kind: "host" }, open => open.apply(steps))
    .then(() => undefined)
}
