// interface/canvases — the canvases a page shows: the rules' canvas index
// (`indexCanvases`, the host's too), each canvas with its threads and their
// roots. A canvas's signals are its threads' (`canvasStatus`, `canvasWork`).

import type {
  CanvasId,
  CardRecord,
  RootId,
  ThreadId,
  ThreadRecord,
} from "@pinetrie/core"
import { boardCanvases, type CanvasIndex, indexCanvases } from "@pinetrie/rules"

/** One canvas, as the page reads it. */
export interface CanvasThreads {
  readonly canvas: CanvasId
  /** Its thread cards, in its canvas's order. */
  readonly threads: readonly ThreadId[]
  /** The roots of its threads, each once, in canvas order. */
  readonly roots: readonly RootId[]
}

/** Every canvas, and the index the host decides by too. */
export interface Canvases {
  readonly index: CanvasIndex
  readonly byId: ReadonlyMap<CanvasId, CanvasThreads>
}

/**
 * Every canvas whose card is on the board (`boardCanvases`), its canvas read
 * from `cards`, and each thread's root from its record.
 */
export function canvasesOnBoard(input: {
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
}): Canvases {
  const index = indexCanvases(input.cards, input.threads)
  const byId = new Map<CanvasId, CanvasThreads>()
  for (const canvas of [...boardCanvases(input.cards)].sort())
    byId.set(canvas, {
      canvas,
      threads: index.threadsOf.get(canvas) ?? [],
      roots: index.rootsOf.get(canvas) ?? [],
    })
  return { index, byId }
}
