// pi/carry — what a compaction carries past its cut: the lane's prompt, and
// the context entries a run read.
//
// pi compacts in the middle of a run, and replaces everything before its cut
// with a summary. A system message summarised away would leave the next
// request without the lane's prompt, and a context entry (a thread's pinned
// cards, a canvas's, the canvas list) would leave the model without it until
// a later run restated it. The `before_compaction` hook (`agent.ts`) decides
// with `carryPrompt` and `carryContext`, runs pi's own `compact()`, and
// assembles with `withCarried`, so the compaction entry holds them and the
// tree records what the model reads after it. Every context kind is the rules'
// context table's (`CONTEXT_KINDS`), so a kind added there is carried.

import type {
  AgentMessage,
  CompactionPreparation,
  CompactResult,
} from "@earendil-works/pi-agent-core"
import {
  getCurrentSystemMessage,
  type SystemMessage,
} from "@earendil-works/pi-ai"
import { CONTEXT, CONTEXT_KINDS } from "@pinetrie/rules"

/**
 * The lane's prompt as one system message for the retained tail: every system
 * message being summarised, folded in order. Empty when none is. A later
 * patch the tail keeps applies after it.
 */
export function carryPrompt(
  preparation: Pick<
    CompactionPreparation,
    "messagesToSummarize" | "turnPrefixMessages"
  >,
): readonly SystemMessage[] {
  // pi-ai's fold reads the system messages among any others.
  const folded = getCurrentSystemMessage([
    ...preparation.messagesToSummarize,
    ...preparation.turnPrefixMessages,
  ])
  return folded === undefined ? [] : [folded]
}

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
