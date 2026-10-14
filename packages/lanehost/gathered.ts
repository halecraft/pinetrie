// lanehost/gathered — what a host holds of one lane's runs between drains,
// as a value: the traces folded so far, and whether a drain is running. The
// notices not folded yet are the client's batch, which it alone writes;
// this decides when the batch is folded and what a drain does with it.

import type { FoldNotices, RunNotice, RunTraces } from "@pinetrie/core"

export interface Gathered {
  readonly traces: RunTraces
  /** `tracesSize(traces)` at their last fold. */
  readonly size: number
  /** A drain's callback is running: a full batch waits for its end. */
  readonly draining: boolean
}

/**
 * The fewest notices a batch holds before it is folded. A fold copies the
 * traces it touches, so a batch waits for as many notices as the traces
 * hold, and never fewer than this: each notice then costs constant work on
 * average, and a batch weighs at most about what the traces do.
 */
export const MIN_BATCH = 4096

/** The work one fold copies: each trace's paths and shared accesses. */
function tracesSize(traces: RunTraces): number {
  let size = 0
  for (const t of traces.values()) size += t.paths.size + t.accesses.length
  return size
}

export const newGathered = (): Gathered => ({
  traces: new Map(),
  size: 0,
  draining: false,
})

/** Whether a batch of `length` notices is folded now; never while a drain runs. */
export const isBatchFull = (g: Gathered, length: number): boolean =>
  !g.draining && length >= Math.max(MIN_BATCH, g.size)

/** `g` with `batch` folded in. */
export function foldedWith(
  g: Gathered,
  batch: readonly RunNotice[],
  fold: FoldNotices,
): Gathered {
  if (batch.length === 0) return g
  const traces = fold(g.traces, batch)
  return { ...g, traces, size: tracesSize(traces) }
}

/** `batch` folded in, and `g` draining: its `traces` are what the drain is given. */
export const drainStarted = (
  g: Gathered,
  batch: readonly RunNotice[],
  fold: FoldNotices,
): Gathered => ({ ...foldedWith(g, batch, fold), draining: true })

/**
 * A drain's end: the traces it returned, or for `null`, a drain that threw,
 * the ones it was given; `late`, what arrived while it ran, folded onto
 * them. Nothing folds while a drain runs, so `g`'s traces are still the
 * ones it was given.
 */
export const drainEnded = (
  g: Gathered,
  next: RunTraces | null,
  late: readonly RunNotice[],
  fold: FoldNotices,
): Gathered =>
  foldedWith(
    {
      traces: next ?? g.traces,
      size: tracesSize(next ?? g.traces),
      draining: false,
    },
    late,
    fold,
  )
