// interface/palette — which colour slot each track takes (ADR-0089, S110). A
// track is a branch's rank in its root (ADR-0068); its root's id picks the
// slot its trunk takes, and each later track steps on by `STRIDE`, so roots
// start on different slots and a root's branches spread round the palette.
// Every client takes the same slots; each draws a slot in its own colours
// (the page's are `colors.ts`). Pure.

import type { RootId, TaskId } from "@pinetrie/core"
import { PENDING_TRACK } from "./column-paths.ts"

/** How many colours a client draws the tracks in. */
export const SLOTS = 12

/** Coprime with the 12 slots, near 12/φ: neighbouring tracks land 5 slots apart. */
export const STRIDE = 7

/** A colour slot: a palette index, or a fresh branch's. */
export type ColorSlot = number | "pending"

/** A string's 32-bit hash: a person's colour (`presence.tsx`) and a root's seed. */
export function stringHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1)
    h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  return h
}

/** The slot a root's trunk takes: the same on every device, written nowhere. */
export const rootSeed = (root: RootId): number => stringHash(root) % SLOTS

/** Track `track`'s slot in a root seeded `seed`. */
export const trackSlot = (seed: number, track: number): ColorSlot =>
  track === PENDING_TRACK ? "pending" : (seed + STRIDE * track) % SLOTS

/**
 * A task's slot (ADR-0116): what its initials are drawn on, seeded by its
 * id as a root's trunk is by its root's.
 */
export const taskSlot = (task: TaskId): ColorSlot =>
  trackSlot(stringHash(task) % SLOTS, 0)
