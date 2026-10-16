// pi/pinned — the context entries a run read, kept in view across pi's
// compaction.
//
// pi compacts in the middle of a run, and a context entry summarised away
// (a thread's pinned cards, a canvas's, the canvas list) would leave the model
// without it until a later run restated it. The `before_compaction` hook
// (`agent.ts`) decides with `carryContext`, runs pi's own `compact()`, and
// assembles with `withCarried`, so the compaction entry holds them and the
// tree records what the model reads after it. Every kind is the rules'
// context table's (`CONTEXT_KINDS`), so a kind added there is carried.

import type {
  AgentMessage,
  CompactionPreparation,
  CompactResult,
} from "@earendil-works/pi-agent-core"
import { CONTEXT, CONTEXT_KINDS } from "@pinetrie/rules"

/**
 * The context entries to carry into the retained tail: of each kind, the
 * newest one being summarised, when the tail holds none of that kind; in
 * the table's order. Empty when there is nothing to carry.
 */
export function carryContext(
  preparation: Pick<
    CompactionPreparation,
    "messagesToSummarize" | "turnPrefixMessages" | "retainedTail"
  >,
): readonly AgentMessage[] {
  const summarised = [
    ...preparation.messagesToSummarize,
    ...preparation.turnPrefixMessages,
  ]
  return CONTEXT_KINDS.flatMap(kind => {
    const is = (m: AgentMessage) => CONTEXT[kind].decode(m) !== undefined
    if (preparation.retainedTail.some(is)) return []
    const newest = summarised.findLast(is)
    return newest === undefined ? [] : [newest]
  })
}

/** pi's compaction with `carried` at the head of its retained tail. */
export const withCarried = (
  result: CompactResult,
  carried: readonly AgentMessage[],
): CompactResult => ({
  ...result,
  retainedTail: [...carried, ...result.retainedTail],
})
