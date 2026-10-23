// host/canvases — the canvas index as the host reads it now: from the places, where
// each thread's card is, and the threads' records, each one's root. The gate
// (`planGate`), a move's history (`movesHistory`), archiving and what a starting
// host loads all read this; the page reads the same index (`canvasesOnBoard`,
// `@pinetrie/interface`).

import type { ThreadId } from "@pinetrie/core"
import { readArchived, readPlaces, readThreads } from "@pinetrie/reads"
import { archivedIn, type CanvasIndex, indexCanvases } from "@pinetrie/rules"
import type { PlacesDocHandle, SessionDocHandle } from "@pinetrie/schema"

/** The canvas index over the places and the session as they are now. */
export const canvasesNow = (docs: {
  readonly places: PlacesDocHandle
  readonly session: SessionDocHandle
}): CanvasIndex =>
  indexCanvases(readPlaces(docs.places), readThreads(docs.session))

/** Whether `lane`'s thread sits in an archived canvas: its lane will never run again, and its ref is deleted. */
export function isLaneArchived(
  docs: {
    readonly places: PlacesDocHandle
    readonly session: SessionDocHandle
  },
  lane: ThreadId,
): boolean {
  const canvas = canvasesNow(docs).canvasOfThread.get(lane)
  return (
    archivedIn(
      canvas === undefined ? [] : [canvas],
      readArchived(docs.session, docs.places),
    ) !== null
  )
}
