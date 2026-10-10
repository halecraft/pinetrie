// host/canvas — what a run is told of its thread's task (ADR-0116): the
// task's canvas list, and the cards pinned to the task. Each is written only
// when it differs from the newest of its kind on the lane's path
// (`canvasInView`, `taskPinnedInView`), so an unchanged task keeps the
// prompt's cache (S92). Gather the facts, plan with the rules
// (`planCanvasRead`, `planTaskPinnedRead`), encode; `runs.ts` writes them
// before the run's prompt.

import {
  canvasInView,
  type NoteColumnId,
  type RootWork,
  type TaskId,
  type ThreadId,
  taskPinnedInView,
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
  type CanvasMessage,
  canvasList,
  displayName,
  encodeCanvas,
  encodeTaskPinned,
  NEW_NOTES_TITLE,
  notesIn,
  pinnedReads,
  planCanvasRead,
  planTaskPinnedRead,
  type TaskIndex,
  type TaskPinnedMessage,
  taskPinnedOf,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import { tasksNow } from "./tasks.ts"

/** What a run on a lane is told of its task first, in the order it is written. */
export type TaskContext = readonly (CanvasMessage | TaskPinnedMessage)[]

/**
 * The title a task is told by: its title, else its first thread's root's
 * first line. Pure.
 */
export const taskTitle = (
  task: TaskId,
  tasks: TaskIndex,
  titles: ReadonlyMap<TaskId, { readonly title: string }>,
  firstLines: ReadonlyMap<string, { readonly firstLine: string }>,
): string => {
  const root = tasks.rootsOf.get(task)?.[0]
  return (
    titles.get(task)?.title ??
    (root === undefined ? "" : (firstLines.get(root)?.firstLine ?? ""))
  )
}

export function createTaskContext(deps: {
  readonly basics: Pick<Basics, "docs" | "places" | "session" | "live" | "now">
  readonly cards: Pick<CardPort, "hydrate" | "textNow">
}) {
  const { docs, places, session, live, now } = deps.basics

  /**
   * The canvas entry and the task's cards entry a run on `lane` starts with,
   * each only when what the model reads differs; none for a lane whose
   * thread is in no task.
   */
  async function readTaskContext(lane: ThreadId): Promise<TaskContext> {
    // gather
    const tasks = tasksNow({ places, session })
    const task = tasks.taskOfThread.get(lane)
    const doc = docs.docOfLane(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (task === undefined || doc === null || tip === null) return []
    const cards = readPlaces(places)
    const pins = taskPinnedOf(cards, task)
    await deps.cards.hydrate(pins.map(c => c.id))
    const index = readTreeIndex(doc)
    const names = readParticipantNames(session)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))
    const canvas = tasks.canvases.get(task) ?? []
    const work = new Map<ThreadId, RootWork>(
      readRunningLanes(session, live).map(r => [r.lane, "running"] as const),
    )
    const noteColumns = readNoteColumns(session)
    const noteIds = canvas.flatMap(c =>
      c.kind === "note-column" ? [c.id] : [],
    )
    // plan
    const listed = planCanvasRead({
      inView: canvasInView(index, tip),
      now: canvasList({
        task,
        title: taskTitle(task, tasks, readMarks(session), readRoots(session)),
        canvas,
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
    const pinned = planTaskPinnedRead({
      inView: taskPinnedInView(index, tip),
      now: pinnedReads(pins, deps.cards.textNow),
      task,
    })
    // encode
    return [
      ...(listed === null ? [] : [encodeCanvas(listed, now())]),
      ...(pinned === null ? [] : [encodeTaskPinned(pinned, nameOf, now())]),
    ]
  }

  return { readTaskContext }
}
