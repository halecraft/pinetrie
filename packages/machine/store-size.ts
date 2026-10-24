// machine/store-size — how large the store's disk should be, from what it
// holds and the volume holding it, within both settings. The one maker of
// `StoreSize`: a disk is only ever grown to one.

import type { StoreCapabilities } from "./capabilities.ts"
import type { MachineSample } from "./sample.ts"
import {
  leaveFreeBytes,
  minimumUnallocated,
  type StoreSettings,
} from "./store-settings.ts"

const GiB = 1024 ** 3
/** A growth's least step: the larger of a quarter of the disk and this. */
const GROW_AT_LEAST = 64 * GiB

declare const storeSizeBrand: unique symbol
/** A disk size `planStoreSize` planned: within `lanes.store.max` and `lanes.store.leaveFree`. */
export type StoreSize = number & { readonly [storeSizeBrand]: true }

/** The store's disk and the volume holding it, in bytes. */
export interface StoreSizeFacts {
  readonly size: number
  /** What the disk holds: the file's allocated bytes, or btrfs's chunks. */
  readonly allocated: number
  readonly volumeFree: number
  readonly volumeSize: number
}

/**
 * The size to grow the store's disk to, or null for none: only where the
 * backend can grow it, only when its unallocated room is under its floor,
 * by the larger of a quarter and 64 GiB, to at most `lanes.store.max`, and
 * at most what the volume can give while it keeps `lanes.store.leaveFree`.
 * Never smaller than the disk is.
 */
export function planStoreSize(
  facts: StoreSizeFacts,
  settings: Pick<StoreSettings, "max" | "leaveFree">,
  capabilities: StoreCapabilities,
): StoreSize | null {
  if (!capabilities.grow) return null
  const unallocated = facts.size - facts.allocated
  if (unallocated >= minimumUnallocated(facts.size)) return null
  const step = Math.max(Math.floor(facts.size / 4), GROW_AT_LEAST)
  const volumeAllows =
    facts.allocated +
    facts.volumeFree -
    leaveFreeBytes(settings, facts.volumeSize)
  const target = Math.min(
    facts.size + step,
    settings.max ?? Number.POSITIVE_INFINITY,
    volumeAllows,
  )
  return target > facts.size ? (Math.floor(target) as StoreSize) : null
}

/**
 * What the disk would grow to now: `planStoreSize` over the sample's
 * room, the size it is when it would not grow. The one reading of "can it
 * grow", for leaving a failure and for `room-low`'s words alike.
 */
export function plannedStoreSize(
  sample: MachineSample,
  settings: Pick<StoreSettings, "leaveFree" | "max">,
  capabilities: StoreCapabilities,
): number | null {
  const { store } = sample
  if (store === null) return null
  const planned =
    sample.filesystem === null
      ? null
      : planStoreSize(
          {
            size: store.size,
            allocated: store.size - store.unallocated,
            volumeFree: sample.filesystem.free,
            volumeSize: sample.filesystem.size,
          },
          settings,
          capabilities,
        )
  return planned ?? store.size
}
