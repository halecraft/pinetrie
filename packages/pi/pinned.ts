// pi/pinned — the cards a run read, kept in view across pi's compaction
// (ADR-0048, S92).
//
// pi compacts in the middle of a run, and a cards entry summarised away would
// leave the model without its pinned cards until a later run restated them.
// The `before_compaction` hook (`agent.ts`) decides with `carryPinned`, runs
// pi's own `compact()`, and assembles with `withCarried`, so the compaction
// entry holds the cards and the tree records what the model reads after it.

import type {
  AgentMessage,
  CompactionPreparation,
  CompactResult,
} from "@earendil-works/pi-agent-core"
import { decodePinned } from "@pineta/rules"

const isCards = (m: AgentMessage): boolean => decodePinned(m) !== undefined

/**
 * The cards entry to carry into the retained tail: the newest one being
 * summarised, when the tail holds none. Null when the tail has its own, or
 * nothing summarised is one. Pure.
 */
export function carryPinned(
  preparation: Pick<
    CompactionPreparation,
    "messagesToSummarize" | "turnPrefixMessages" | "retainedTail"
  >,
): AgentMessage | null {
  if (preparation.retainedTail.some(isCards)) return null
  return (
    [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ].findLast(isCards) ?? null
  )
}

/** pi's compaction with `cards` at the head of its retained tail. Pure. */
export const withCarried = (
  result: CompactResult,
  cards: AgentMessage,
): CompactResult => ({
  ...result,
  retainedTail: [cards, ...result.retainedTail],
})
