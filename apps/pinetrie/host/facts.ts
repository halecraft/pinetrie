// host/facts — a fact of the host's queued as a card on its thread, the one
// way every module queues one.

import type { ThreadId } from "@pinetrie/core"
import { readPlaces, readThreadName } from "@pinetrie/reads"
import { planFactCard } from "@pinetrie/rules"
import { cardIdOfKind, type QueuedFact } from "@pinetrie/threads"
import type { Basics } from "./basics.ts"
import type { Places } from "./places.ts"

interface FactDeps {
  readonly basics: Pick<Basics, "places" | "session" | "newId" | "log">
  readonly placesWriter: Places
  /** Ask for a lane's drain: an idle lane appends the fact at once. */
  readonly drain: (lane: ThreadId) => void
}

/**
 * Queue `fact` on its lane, in a change of the host's, planned against the
 * places as they are, then ask for its lane's drain. The host's own make is
 * refused by no queue: should one be, it is logged, never dropped silently.
 */
export async function queueFact(
  deps: FactDeps,
  fact: QueuedFact,
): Promise<void> {
  const { log, newId, session } = deps.basics
  const queued = await deps.placesWriter.change({ kind: "host" }, open => {
    // gather and plan, as the places are now
    const steps = planFactCard({
      cards: readPlaces(deps.basics.places),
      id: cardIdOfKind("fact", newId()),
      fact,
    })
    if (steps === null) return false
    open.apply(steps)
    return true
  })
  if (!queued) {
    log(
      `[host] ${readThreadName(session, fact.lane)}: a ${fact.kind} fact was not queued: its card was refused`,
    )
    return
  }
  deps.drain(fact.lane)
}
