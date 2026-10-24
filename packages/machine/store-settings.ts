// machine/store-settings — the store's settings as values, and two
// thresholds that are easy to confuse: `leaveFreeBytes` is the free space
// pine·trie leaves on the person's filesystem holding the store;
// `minimumUnallocated` is the space inside the store that btrfs has not yet
// given to any chunk, below which the store is low.

const GiB = 1024 ** 3

/** Free space to leave: a share of the filesystem, or bytes. */
export type LeaveFree =
  | { readonly percent: number }
  | { readonly bytes: number }

export interface StoreSettings {
  /** The most the store may hold; null for no ceiling of its own. */
  readonly max: number | null
  /** Every amount set; the largest, against the filesystem's size, holds. */
  readonly leaveFree: readonly LeaveFree[]
  /** The metadata open threads' turn snapshots may hold, estimated. */
  readonly snapshotMetadata: number
}

/** What pine·trie leaves free of the filesystem holding the store, unless set. */
export const LEAVE_FREE_DEFAULT: readonly LeaveFree[] = [
  { percent: 10 },
  { bytes: 50 * GiB },
]

/** One amount to leave, in bytes, on a filesystem of `size` bytes. */
const bytesToLeave = (amount: LeaveFree, size: number): number =>
  "percent" in amount ? Math.floor((size * amount.percent) / 100) : amount.bytes

/**
 * The free space to leave on a filesystem of `filesystemSize` bytes: the
 * largest amount, since a percentage and a byte count compare only once the
 * size is known. None set leaves nothing.
 */
export const leaveFreeBytes = (
  settings: Pick<StoreSettings, "leaveFree">,
  filesystemSize: number,
): number =>
  Math.max(0, ...settings.leaveFree.map(f => bytesToLeave(f, filesystemSize)))

/** The share of the store, in percent, under whose unallocated space it is low. */
export const MINIMUM_UNALLOCATED_PERCENT = 10
/** The least unallocated space a store of any size keeps before it is low. */
export const MINIMUM_UNALLOCATED_FLOOR = 8 * GiB

/** The store's unallocated space below which it is low: its share of it, and the floor at least. */
export const minimumUnallocated = (storeSize: number): number =>
  Math.max(
    Math.floor((storeSize * MINIMUM_UNALLOCATED_PERCENT) / 100),
    MINIMUM_UNALLOCATED_FLOOR,
  )
