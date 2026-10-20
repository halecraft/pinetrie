// host/canvas — what a run is told of its thread's canvas: the canvas
// list, and the cards pinned to the canvas. Gather the facts and the pinned
// cards' texts, plan (`planCanvasContext`, which writes each only when it
// differs from the newest of its kind on the lane's path, so an unchanged
// canvas keeps the prompt's cache), encode; `runs.ts` writes them before the
// run's prompt.

import type { ThreadId, WriterId } from "@pinetrie/core"
import {
  readCardTitles,
  readMarks,
  readNames,
  readParticipantNames,
  readPlaces,
  readRoots,
  readRunningLanes,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type CanvasMessage,
  type CanvasPinnedMessage,
  canvasContextCards,
  displayName,
  encodeCanvas,
  encodeCanvasPinned,
  planCanvasContext,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import { canvasesNow } from "./canvases.ts"
import type { CardPort } from "./cards.ts"
import type { RunDocs } from "./runs.ts"

/** What a run on a lane is told of its canvas first, in the order it is written. */
export type CanvasContext = readonly (CanvasMessage | CanvasPinnedMessage)[]

export function createCanvasContext(deps: {
  readonly basics: Pick<Basics, "places" | "session" | "live" | "now">
  /** A run reads its canvas's context at its start, its root held by its lease. */
  readonly runs: RunDocs
  readonly cards: Pick<CardPort, "hydrate" | "textNow">
}) {
  const { places, session, live, now } = deps.basics
  const docs = deps.runs

  /**
   * The canvas entry and the canvas's cards entry a run on `lane` starts with,
   * each only when what the model reads differs; none for a lane whose
   * thread is in no canvas.
   */
  async function readCanvasContext(lane: ThreadId): Promise<CanvasContext> {
    // gather: the canvas, the lane's tip, then the texts the plan reads
    const canvases = canvasesNow({ places, session })
    const canvas = canvases.canvasOfThread.get(lane)
    const doc = docs.docOf(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (canvas === undefined || doc === null || tip === null) return []
    const cards = readPlaces(places)
    const read = canvasContextCards(cards, canvas)
    await deps.cards.hydrate(read)
    const names = readParticipantNames(session)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))
    // plan
    const { listed, pinned } = planCanvasContext({
      lane,
      canvas,
      index: readTreeIndex(doc),
      tip,
      cards,
      canvases,
      titles: readMarks(session),
      firstLines: readRoots(session),
      names: readNames(session),
      running: readRunningLanes(session, live).map(r => r.lane),
      cardTitles: readCardTitles(session),
      texts: new Map(read.map(card => [card, deps.cards.textNow(card)])),
      nameOf,
    })
    // encode
    return [
      ...(listed === null ? [] : [encodeCanvas(listed, now())]),
      ...(pinned === null ? [] : [encodeCanvasPinned(pinned, nameOf, now())]),
    ]
  }

  return { readCanvasContext }
}
