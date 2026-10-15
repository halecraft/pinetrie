// host/tasks — the task index as the host reads it now: from the places, where
// each thread's card is, and the threads' records, each one's root. The gate
// (`planGate`), a move's history (`historyOf`), archiving and what a starting
// host loads all read this; the page reads the same index (`tasksOf`,
// `@pinetrie/interface`).

import { readPlaces, readThreads } from "@pinetrie/reads"
import { indexTasks, type TaskIndex } from "@pinetrie/rules"
import type { PlacesDocHandle, SessionDocHandle } from "@pinetrie/schema"

/** The task index over the places and the session as they are now. */
export const tasksNow = (docs: {
  readonly places: PlacesDocHandle
  readonly session: SessionDocHandle
}): TaskIndex => indexTasks(readPlaces(docs.places), readThreads(docs.session))
