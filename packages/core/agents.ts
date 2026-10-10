// agents — what the tree says of other threads' agents in a thread
// (ADR-0128): its members, what an asked agent has heard of the thread that
// asked, and whether a round of asks has been answered. Each is read from
// the path, as a thread's mode is (ADR-0021): nothing about them is stored
// beside the entries.

import type { AgentCandidate, EntryId, ThreadId, ThreadName } from "./index.ts"
import { ancestry, newestOnPath, type TreeIndex } from "./tree.ts"

/**
 * The members of the thread ending at `tip`: every agent a message on the
 * path invited, in the order invited, less those a later fact says were
 * dismissed or left. A branch has the members its thread had where it
 * forked. Pure.
 */
export function threadMembers(
  index: TreeIndex,
  tip: EntryId | null,
): readonly ThreadId[] {
  const members: ThreadId[] = []
  for (const id of ancestry(index, tip).path.toReversed()) {
    const message = index.entries[id]?.message
    for (const thread of message?.invites ?? [])
      if (!members.includes(thread)) members.push(thread)
    const gone = message?.member?.gone
    if (gone !== undefined) {
      const at = members.indexOf(gone)
      if (at >= 0) members.splice(at, 1)
    }
  }
  return members
}

/**
 * The newest message on the path ending at `tip` that invited `thread`'s
 * agent; null when none did. What it is told when first asked starts there.
 * Pure.
 */
export const lastInvitation = (
  index: TreeIndex,
  tip: EntryId | null,
  thread: ThreadId,
): EntryId | null =>
  newestOnPath(
    index,
    tip,
    e => ((e.message?.invites ?? []).includes(thread) ? e.id : undefined),
    "pass",
  )

/**
 * The newest entry of `from` that the thread ending at `tip` has heard: the
 * last source entry of its newest heard entry from that thread. Null when it
 * has heard none since a compaction, which summarised what it heard, so the
 * next ask copies it again, as base news is told again past one (ADR-0080).
 * Pure.
 */
export const lastHeardEntry = (
  index: TreeIndex,
  tip: EntryId | null,
  from: ThreadId,
): EntryId | null =>
  newestOnPath(
    index,
    tip,
    e => {
      const heard = e.message?.heard
      return heard?.from === from ? (heard.entries.at(-1) ?? null) : undefined
    },
    () => null,
  )

/**
 * Whether the chat at `chat` has had an answer from every member it asked,
 * on the path ending at `tip`: each answer names the entry its relay came
 * from (`AnswerDetails.source`). False for a chat that asked none. Pure.
 */
export function isRoundAnswered(
  index: TreeIndex,
  tip: EntryId | null,
  chat: EntryId,
): boolean {
  const asked = index.entries[chat]?.message?.asks ?? []
  if (asked.length === 0) return false
  const answered = new Set<ThreadId>()
  for (const id of ancestry(index, tip).path) {
    if (id === chat) break
    const answer = index.entries[id]?.message?.answer
    if (answer?.source === chat) answered.add(answer.from)
  }
  return asked.every(t => answered.has(t))
}

/**
 * The other threads' agents a message in `here` may name (ADR-0128): every
 * thread in `canvas` (every open task's named threads, `reachableAgents` in
 * rules) but `here`, each a member when `members` (`threadMembers` of its
 * path) holds it. The host and the composer both build them so, so the
 * button's promise and the host's decision agree. Pure.
 */
export const agentCandidates = (
  canvas: readonly { readonly thread: ThreadId; readonly name: ThreadName }[],
  here: ThreadId,
  members: readonly ThreadId[],
): readonly AgentCandidate[] =>
  canvas
    .filter(t => t.thread !== here)
    .map(t => ({ ...t, member: members.includes(t.thread) }))
