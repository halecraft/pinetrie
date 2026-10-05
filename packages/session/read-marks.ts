// session/read-marks — when a tab writes how far you have read a thread
// (ADR-0077), decided. A column at its thread's end reports each new end;
// writing every one would grow your attention document by about 10 bytes a
// time, for good (S101), so a lane's mark is written at most once a
// `READ_EVERY`, and at once when you leave. A mark only moves forward, and
// nothing is written before the host's copy has arrived: a mark written
// earlier can win over a further one written on another device (S101).
// `attention-doc.ts` carries it out. Pure.

import type { EntryId, LaneName } from "@pinetrie/core"

/** The least time between two writes of one lane's mark. */
export const READ_EVERY = 5_000

/** What `readStep` remembers between calls. */
export interface ReadMemory {
  /** When each lane's mark was last written. */
  readonly written: ReadonlyMap<LaneName, number>
  /** Marks reported and not yet written. */
  readonly waiting: ReadonlyMap<LaneName, EntryId>
}

export const NO_READS: ReadMemory = { written: new Map(), waiting: new Map() }

/** Entry ids are uuidv7: a later id is a later entry, along a lane too. */
const after = (a: EntryId, b: EntryId | undefined): boolean =>
  b === undefined || a > b

/**
 * One step: take `next` in, and say which marks to write now, and when to
 * look again (null for never). A mark at or behind the stored one is
 * dropped. One waits while its lane was written within `READ_EVERY`,
 * unless `leaving`, and every one waits while the host's copy has not
 * arrived (`ready`).
 */
export function readStep(
  memory: ReadMemory,
  input: {
    readonly stored: ReadonlyMap<LaneName, EntryId>
    readonly next: { readonly lane: LaneName; readonly entry: EntryId } | null
    readonly ready: boolean
    readonly leaving: boolean
    readonly now: number
  },
): {
  readonly memory: ReadMemory
  readonly write: ReadonlyMap<LaneName, EntryId>
  readonly wake: number | null
} {
  const { stored, next, now } = input
  const waiting = new Map(memory.waiting)
  if (next !== null && after(next.entry, waiting.get(next.lane)))
    waiting.set(next.lane, next.entry)
  for (const [lane, entry] of waiting)
    if (!after(entry, stored.get(lane))) waiting.delete(lane)
  if (!input.ready)
    return { memory: { ...memory, waiting }, write: new Map(), wake: null }
  const written = new Map(memory.written)
  const write = new Map<LaneName, EntryId>()
  let wake: number | null = null
  for (const [lane, entry] of waiting) {
    const due = (written.get(lane) ?? -Infinity) + READ_EVERY
    if (input.leaving || now >= due) {
      write.set(lane, entry)
      written.set(lane, now)
      waiting.delete(lane)
    } else wake = wake === null ? due : Math.min(wake, due)
  }
  return { memory: { written, waiting }, write, wake }
}
