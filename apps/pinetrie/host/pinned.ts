// host/pinned — what a run reads of its thread's pinned cards (ADR-0048, S92).
//
// Gather the thread's pinned cards and their texts, waiting a bounded time
// for each as its sender had it; plan the cards entry against what the model
// last read on the lane's path (`planPinnedRead`). `runs.ts` only awaits the
// result, so a run's lifecycle knows nothing of cards.

import {
  type LaneName,
  pinnedInView,
  type SentCard,
  type WriterId,
} from "@pinetrie/core"
import {
  readLanes,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  cardsAt,
  displayName,
  encodePinned,
  type PinnedMessage,
  pinnedReads,
  planPinnedRead,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"

/**
 * How long a run waits for its pinned cards' text as its sender had it.
 * After it, the run reads what the host holds, and the column marks a card
 * whose edit came too late as changed since the agent read it.
 */
export const PINNED_WAIT_MS = 2000

/**
 * Resolves once every text holds what its sender had, after `ms`, or once
 * `signal` aborts, whichever is first; no wait is left subscribed.
 */
export async function waitFor(
  cards: Pick<CardPort, "whenHolds">,
  wants: readonly SentCard[],
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (wants.length === 0) return
  const giveUp = AbortSignal.any([signal, AbortSignal.timeout(ms)])
  await Promise.all(wants.map(w => cards.whenHolds(w.id, w.seen, giveUp)))
}

export function createPinned(deps: {
  readonly basics: Pick<Basics, "docs" | "live" | "places" | "session" | "now">
  readonly cards: Pick<CardPort, "hydrate" | "textNow" | "whenHolds">
  readonly waitMs?: number
}) {
  const { docs, live, places, session, now } = deps.basics
  const { cards } = deps

  /** The pinned cards at the lane's tip: its thread's end. */
  function pinnedAt(lane: LaneName) {
    const doc = docs.docOfLane(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (doc === null || tip === null) return null
    const index = readTreeIndex(doc)
    const records = readPlaces(places)
    const lanes = readLanes(
      { doc, live },
      index,
      records,
      readQueueHolds(session),
    )
    return { index, tip, pinned: cardsAt("pinned", tip, records, lanes, index) }
  }

  /**
   * The cards entry a run on `lane` starts with, or null when the model
   * already reads the thread's pinned cards as they are. `seen` is each
   * card's version as the sender had it.
   */
  async function readPinned(
    lane: LaneName,
    seen: readonly SentCard[],
    signal: AbortSignal,
  ): Promise<PinnedMessage | null> {
    // gather: the texts, loaded, then as the sender had them, within the wait
    const before = pinnedAt(lane)
    if (before === null) return null
    await cards.hydrate(before.pinned.map(c => c.id))
    const ids = new Set(before.pinned.map(c => c.id))
    await waitFor(
      cards,
      seen.filter(s => ids.has(s.id)),
      deps.waitMs ?? PINNED_WAIT_MS,
      signal,
    )
    // A card may have been pinned or unpinned during the wait: read again.
    const after = pinnedAt(lane)
    if (after === null) return null
    await cards.hydrate(after.pinned.map(c => c.id))
    const names = readParticipantNames(session)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))

    // plan
    const view = planPinnedRead({
      inView: pinnedInView(after.index, after.tip),
      now: pinnedReads(after.pinned, id => cards.textNow(id)),
      lane,
    })
    return view === null ? null : encodePinned(view, nameOf, now())
  }

  return { readPinned }
}
