// startup — what a starting host does with the lanes it finds, pure.

import type { CardRecord, LaneName } from "@pineta/core"
import { queuedOn } from "./card.ts"

/**
 * Where hosts before queued cards (ADR-0048 step 3) held messages and
 * updates for a busy lane. Nothing writes it now; a starting host deletes
 * what is left there, logging each one's text, since nobody can see it.
 */
export const LEGACY_OUTBOX_NAMESPACE = "pineta.outbox"

/** A value left in the old outbox, as a starting host deletes and logs it. */
export interface LegacyHeld {
  readonly key: string
  /** Its message's text, or what it was when it held no message. */
  readonly text: string
}

/** What an old outbox value held, worded for the log. Total. */
function legacyText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "(unreadable)"
  const v = value as { kind?: unknown; details?: { text?: unknown } }
  if (v.kind === "update") return "(an update from your work)"
  return typeof v.details?.text === "string" ? v.details.text : "(unreadable)"
}

/**
 * What a starting host runs, pure. A lane a crash interrupted holds its
 * operation open, so it is resumed before anything queued for it (S36 item
 * 18), and its run's end drains it. Every other lane with cards queued for
 * it is drained, since no run's end will. Old outbox values are deleted.
 * What does not survive a process (runs, streams) is cleared first, by
 * `clearStreams` in `@pineta/schema`.
 */
export function planStartup(input: {
  readonly cards: readonly CardRecord[]
  /** Lanes a crash interrupted, as pi reports them. */
  readonly interrupted: readonly LaneName[]
  /** Every value under `LEGACY_OUTBOX_NAMESPACE`. */
  readonly outbox: readonly { readonly key: string; readonly value: unknown }[]
}): {
  readonly resume: readonly LaneName[]
  readonly drain: readonly LaneName[]
  readonly discard: readonly LegacyHeld[]
} {
  const resume = [...new Set(input.interrupted)]
  const lanes = new Set<LaneName>()
  for (const c of input.cards)
    if (c.place.kind === "queued") lanes.add(c.place.lane)
  const drain = [...lanes]
    .filter(lane => queuedOn(input.cards, lane).length > 0)
    .filter(lane => !resume.includes(lane))
  const discard = input.outbox.map(({ key, value }) => ({
    key,
    text: legacyText(value),
  }))
  return { resume, drain, discard }
}
