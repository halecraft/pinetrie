// machine/bounds — the bounds a sample is judged by, made once from the
// numbers the planners act at: the store's room and the filesystem's free
// space, which `health.ts` judges its level causes by, and memory's and its
// pressure's, read from the rungs' own table. The Health page is served the same values, so
// what it calls near and what the planners act on cannot drift apart.

import type { ActingBound } from "@pinetrie/core"
import { RUNG_BOUNDS } from "./rung.ts"
import type { MachineSample } from "./sample.ts"
import {
  leaveFreeBytes,
  minimumUnallocated,
  type StoreSettings,
} from "./store-settings.ts"

const GiB = 1024 ** 3

/** Unallocated space below which the store is spent: a write may fail. */
export const ROOM_SPENT = GiB
/** Unallocated space the store must regain before it is no longer spent. */
export const ROOM_SPENT_CLEAR = 2 * GiB
/** A low store, or filesystem, is clear again only this far above its threshold. */
export const CLEAR_MARGIN = 1.1

/** Memory's, in available bytes of `total`: rung 2 holds starts, rung 3 pauses threads. */
export const memoryBounds = (total: number): readonly ActingBound[] => [
  {
    worse: "below",
    acts: RUNG_BOUNDS[2].enter.availableShareBelow * total,
    clears: RUNG_BOUNDS[2].clear.availableShareAbove * total,
    does: "hold-starts",
  },
  {
    worse: "below",
    acts: RUNG_BOUNDS[3].enter.availableShareBelow * total,
    clears: RUNG_BOUNDS[3].clear.availableShareAbove * total,
    does: "pause-threads",
  },
]

/** Pressure's, in `full_avg10`, as the rungs read a stall that is the machine's. */
export const PRESSURE_BOUNDS: readonly ActingBound[] = [
  {
    worse: "above",
    acts: RUNG_BOUNDS[2].enter.fullAvg10,
    clears: RUNG_BOUNDS[2].clear.fullAvg10,
    does: "hold-starts",
  },
  {
    worse: "above",
    acts: RUNG_BOUNDS[3].enter.fullAvg10,
    clears: RUNG_BOUNDS[3].clear.fullAvg10,
    does: "pause-threads",
  },
]

/** The store's, in unallocated bytes of a store of `size`. */
export const storeBounds = (
  size: number,
): {
  readonly low: ActingBound
  readonly spent: ActingBound
} => {
  const minimum = minimumUnallocated(size)
  return {
    low: {
      worse: "below",
      acts: minimum,
      clears: minimum * CLEAR_MARGIN,
      does: "delete-snapshots",
    },
    spent: {
      worse: "below",
      acts: ROOM_SPENT,
      clears: ROOM_SPENT_CLEAR,
      does: "writes-may-fail",
    },
  }
}

/** The filesystem's holding the store, in free bytes of one of `size`. */
export const filesystemBound = (
  settings: Pick<StoreSettings, "leaveFree">,
  size: number,
): ActingBound => {
  const leaveFree = leaveFreeBytes(settings, size)
  return {
    worse: "below",
    acts: leaveFree,
    clears: leaveFree * CLEAR_MARGIN,
    does: "stop-growing",
  }
}

/** Every bound a sample is judged by, each vital's first reached first; null where its reading was not taken. */
export interface ActingBounds {
  readonly memory: readonly ActingBound[]
  readonly pressure: readonly ActingBound[]
  readonly store: readonly ActingBound[] | null
  readonly filesystem: readonly ActingBound[] | null
}

export function actingBounds(
  sample: MachineSample,
  settings: Pick<StoreSettings, "leaveFree">,
): ActingBounds {
  const { store, filesystem } = sample
  const room = store === null ? null : storeBounds(store.size)
  return {
    memory: memoryBounds(sample.machine.memoryTotal),
    pressure: PRESSURE_BOUNDS,
    store: room === null ? null : [room.low, room.spent],
    filesystem:
      filesystem === null ? null : [filesystemBound(settings, filesystem.size)],
  }
}
