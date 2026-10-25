// copy — a thread copied: a new thread forked at the source's end, put as its
// own card where it was dropped, with the source's title.

import type { ThreadId, ValueWrite, WriterId } from "@pinetrie/core"
import {
  type CardRecord,
  entryThread,
  type Intent,
  type MoveRefusal,
  type ThreadRecord,
  type TitledCardId,
  type TreeIndex,
} from "@pinetrie/threads"
import { planThreadOpen } from "./canvas-index.ts"
import { CARD_TITLE, type CardTitleRecord } from "./card-title.ts"
import type { PlaceStep } from "./place-steps.ts"
import { setRecord } from "./records.ts"
import { threadSetAside } from "./set-aside.ts"

/** A copy as its copier asks for it: the source, the end they saw, and where its card goes. */
export type CopyThread = Omit<Extract<Intent, { kind: "copy-thread" }>, "kind">

export type CopyPlan =
  | {
      readonly kind: "copy"
      /** The copy's record, its root and fork its source's end's; then the source's title, if it has one. */
      readonly records: readonly ValueWrite<"session">[]
      /** The cards re-ranked to make room, then the copy's card. */
      readonly steps: readonly PlaceStep[]
    }
  | {
      readonly kind: "refused"
      /**
       * `unknown`: the source has no record, or `end` is not in it;
       * `taken`: the copy's id names a thread already; `in-others-inventory`:
       * the source is in someone else's inventory; or a move's refusal.
       */
      readonly why: "unknown" | "taken" | "in-others-inventory" | MoveRefusal
    }

/**
 * A copy of `source` at `end`, by `sender`: refused unless `end` is in the
 * source (`entryThread`), so a copy forks within what its copier saw; unless
 * its id is new; unless the source is on a canvas or in the sender's own
 * inventory. An archived source copies: archiving freezes a thread's end,
 * not its history. Its card lands where it was dropped, ranked as a move's
 * is (`planMoveTargets`), or in the sender's inventory while it has room.
 * A titled source's copy has its title, still naming who set it.
 */
export function planCopy(input: {
  readonly copy: CopyThread
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Every titled card's title: the source's is the copy's. */
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
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
    entryThread(input.index, copy.end) !== copy.source
  )
    return { kind: "refused", why: "unknown" }
  if (
    input.threads.has(move.card) ||
    input.index.firstOf.has(move.card) ||
    cards.some(c => c.id === move.card)
  )
    return { kind: "refused", why: "taken" }
  const setAside = threadSetAside(cards, copy.source)
  if (setAside?.kind === "in-inventory" && setAside.holder !== sender)
    return { kind: "refused", why: "in-others-inventory" }
  // Onto a canvas, ranked where it was dropped; or into an inventory.
  const { to } = move
  if (to.kind === "trash" || to.kind === "back" || to.kind === "new-canvas")
    return { kind: "refused", why: "no-place" }
  const opened = planThreadOpen({
    thread: move.card,
    origin: { kind: "fork", at: copy.end, how: "copy" },
    root: source.root,
    by: sender,
    now: input.now,
    placement: to.kind === "inventory" ? to : { kind: "spot", to },
    opens: null,
    cards,
  })
  if (opened.kind === "refused") return { kind: "refused", why: opened.code }
  const title = input.titles.get(copy.source)
  return {
    kind: "copy",
    records:
      title === undefined
        ? opened.records
        : [
            ...opened.records,
            setRecord(CARD_TITLE, {
              card: move.card,
              title: title.title,
              by: title.by,
              at: input.now,
            }),
          ],
    steps: opened.steps,
  }
}
