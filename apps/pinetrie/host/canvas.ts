// host/canvas — what a run is told of its thread's canvas: the canvas
// list, and the cards pinned to the canvas. Each is written only when it differs
// from the newest of its kind on the lane's path (`canvasInView`,
// `canvasPinnedInView`), so an unchanged canvas keeps the prompt's cache. Gather
// the facts, plan with the rules (`planCanvasRead`, `planCanvasPinnedRead`),
// encode; `runs.ts` writes them before the run's prompt.

import {
  type AgentWork,
  type CanvasId,
  canvasInView,
  canvasPinnedInView,
  type NoteColumnId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  readMarks,
  readNames,
  readNoteColumns,
  readParticipantNames,
  readPlaces,
  readRoots,
  readRunningLanes,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type CanvasIndex,
  type CanvasMessage,
  type CanvasPinnedMessage,
  canvasList,
  canvasPinnedCards,
  displayName,
  encodeCanvas,
  encodeCanvasPinned,
  NEW_NOTES_TITLE,
  notesIn,
  pinnedReads,
  planCanvasPinnedRead,
  planCanvasRead,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import { canvasesNow } from "./canvases.ts"
import type { CardPort } from "./cards.ts"
import type { RunDocs } from "./runs.ts"

/** What a run on a lane is told of its canvas first, in the order it is written. */
export type CanvasContext = readonly (CanvasMessage | CanvasPinnedMessage)[]

/**
 * The title a canvas is told by: its title, else its first thread's root's first
 * line.
 */
export const canvasTitle = (
  canvas: CanvasId,
  canvases: CanvasIndex,
  titles: ReadonlyMap<CanvasId, { readonly title: string }>,
  firstLines: ReadonlyMap<string, { readonly firstLine: string }>,
): string => {
  const root = canvases.rootsOf.get(canvas)?.[0]
  return (
    titles.get(canvas)?.title ??
    (root === undefined ? "" : (firstLines.get(root)?.firstLine ?? ""))
  )
}

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
    // gather
    const canvases = canvasesNow({ places, session })
    const canvas = canvases.canvasOfThread.get(lane)
    const doc = docs.docOf(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (canvas === undefined || doc === null || tip === null) return []
    const cards = readPlaces(places)
    const pins = canvasPinnedCards(cards, canvas)
    await deps.cards.hydrate(pins.map(c => c.id))
    const index = readTreeIndex(doc)
    const names = readParticipantNames(session)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))
    const here = canvases.cardsOn.get(canvas) ?? []
    const work = new Map<ThreadId, AgentWork>(
      readRunningLanes(session, live).map(r => [r.lane, "running"] as const),
    )
    const noteColumns = readNoteColumns(session)
    const noteIds = here.flatMap(c => (c.kind === "note-column" ? [c.id] : []))
    // plan
    const listed = planCanvasRead({
      inView: canvasInView(index, tip),
      now: canvasList({
        canvas,
        title: canvasTitle(
          canvas,
          canvases,
          readMarks(session),
          readRoots(session),
        ),
        onCanvas: here,
        reading: lane,
        names: readNames(session),
        work,
        noteTitles: new Map<NoteColumnId, string>(
          noteIds.map(id => [
            id,
            noteColumns.get(id)?.title ?? NEW_NOTES_TITLE,
          ]),
        ),
        noteCounts: new Map(
          noteIds.map(id => [id, notesIn(cards, id).length] as const),
        ),
        nameOf,
      }),
    })
    const pinned = planCanvasPinnedRead({
      inView: canvasPinnedInView(index, tip),
      now: pinnedReads(pins, deps.cards.textNow),
      canvas,
    })
    // encode
    return [
      ...(listed === null ? [] : [encodeCanvas(listed, now())]),
      ...(pinned === null ? [] : [encodeCanvasPinned(pinned, nameOf, now())]),
    ]
  }

  return { readCanvasContext }
}
