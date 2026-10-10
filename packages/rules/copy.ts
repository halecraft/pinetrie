// copy — a thread copied (ADR-0117, ADR-0124): a new thread forked at the
// source's end as its copier saw it, put as its own card where it was
// dropped. It writes no entry: its record names its fork, and its first send
// is a branch there, as any branch's is, which starts its lane when it asks
// the agent (ADR-0021). The fork stays in its record after that send, so
// its fork row can say it was copied. Pure.

import {
  type CardRecord,
  type Intent,
  type MoveRefusal,
  makeCard,
  NO_CONTENT,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import { holderOf } from "./held.ts"
import { type PlaceStep, planMake, rankOnCanvas } from "./moves.ts"

/** A copy as its copier asks for it: the source, the end they saw, and where its card goes. */
export type CopyThread = Omit<Extract<Intent, { kind: "copy-thread" }>, "kind">

export type CopyPlan =
  | {
      readonly kind: "copy"
      /** The copy's record: its root and fork are its source's end's. */
      readonly record: ThreadRecord
      /** The cards re-ranked to make room, then the copy's card. */
      readonly steps: readonly PlaceStep[]
    }
  | {
      readonly kind: "refused"
      /**
       * `unknown`: the source has no record, or `end` is not in it;
       * `taken`: the copy's id names a thread already; `held`: someone
       * else holds the source (ADR-0117); or a move's refusal.
       */
      readonly why: "unknown" | "taken" | "held" | MoveRefusal
    }

/**
 * A copy of `source` at `end`, by `sender`: refused unless `end` is in the
 * source (`threadAt`), so a copy forks within what its copier saw; unless
 * its id is new; unless the source is on a canvas or in the sender's own
 * inventory. An archived source copies: archiving freezes a thread's end,
 * not its history. Its card lands where it was dropped, ranked as a move's
 * is (`planMoveTargets`), or in the sender's inventory while it has room.
 */
export function planCopy(input: {
  readonly copy: CopyThread
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** The source's root's tree. */
  readonly index: TreeIndex
  readonly now: number
}): CopyPlan {
  const { copy, sender, cards } = input
  const { move } = copy
  const source = input.threads.get(copy.source)
  if (
    source === undefined ||
    input.index.entries[copy.end] === undefined ||
    threadAt(input.index, copy.end) !== copy.source
  )
    return { kind: "refused", why: "unknown" }
  if (
    input.threads.has(move.card) ||
    input.index.firstOf.has(move.card) ||
    cards.some(c => c.id === move.card)
  )
    return { kind: "refused", why: "taken" }
  const holder = holderOf(cards, copy.source)
  if (holder !== null && holder !== sender)
    return { kind: "refused", why: "held" }
  // Onto a canvas, ranked where it was dropped; or into an inventory.
  const { to: target } = move
  if (target.kind === "trash") return { kind: "refused", why: "no-place" }
  const placed =
    target.kind === "inventory"
      ? { to: target, ranked: null }
      : (() => {
          const ranked = rankOnCanvas(cards, move.card, target)
          return { to: ranked.to, ranked }
        })()
  const { to, ranked } = placed
  const made = planMake(
    cards,
    makeCard(
      "thread",
      move.card,
      to.kind === "inventory" ? to : { ...to, width: 1 },
      NO_CONTENT,
      sender,
    ),
    sender,
  )
  if (made.kind !== "write")
    return {
      kind: "refused",
      why: made.kind === "refused" ? made.code : "no-place",
    }
  return {
    kind: "copy",
    record: {
      thread: move.card,
      root: source.root,
      by: sender,
      createdAt: input.now,
      origin: { kind: "fork", at: copy.end, how: "copy" },
    },
    steps: [...(ranked?.first ?? []), made],
  }
}
