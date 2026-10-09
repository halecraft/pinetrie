// host/canvas-news — a running thread is told when a card is added to its
// task's canvas or taken from it (ADR-0116), and when its own card moves to
// another task (ADR-0124): a fact line steered after the
// turn in flight, as base news is (`base-news.ts`, S103), never a queued
// fact card, which the drain would pop only after the run. Reorders, widths
// and titles wait for the next run's canvas list (`canvas.ts`).
//
// It hears each change to the places the host records (`Provenance`'s
// `onChanged`), plans with `planCanvasFacts` (`@pinetrie/rules`), and steers
// each lane in a keeper step of its own, never awaited from the command
// that made the change.

import type { ThreadId, WriterId } from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import {
  readMarks,
  readNames,
  readNoteColumns,
  readParticipantNames,
  readRoots,
  readRunningLanes,
  readThreads,
} from "@pinetrie/reads"
import {
  type CanvasCard,
  displayName,
  encodeCanvasFact,
  indexTasks,
  NEW_NOTES_TITLE,
  planCanvasFacts,
} from "@pinetrie/rules"
import { type Basics, failed, type HostKeeper } from "./basics.ts"
import { taskTitle } from "./canvas.ts"
import type { PlacesChange } from "./provenance.ts"

/** A card's title as the canvas list names it. */
const titleOf =
  (basics: Pick<Basics, "session">) =>
  (card: CanvasCard): string => {
    switch (card.kind) {
      case "thread":
        return readNames(basics.session).get(card.id) ?? "a thread"
      case "note-column":
        return `note column "${readNoteColumns(basics.session).get(card.id)?.title ?? NEW_NOTES_TITLE}"`
      // A new kind of canvas card does not compile until it has a title.
      default:
        return card satisfies never
    }
  }

export function createCanvasNews(deps: {
  readonly basics: Pick<Basics, "session" | "live" | "log" | "now">
  readonly agent: Pick<Agent, "lane">
  readonly keeper: Pick<HostKeeper, "run">
}): { readonly changed: (change: PlacesChange) => void } {
  const { basics } = deps
  return {
    changed(change) {
      // gather and plan, as the change left the places
      const running = new Set<ThreadId>(
        readRunningLanes(basics.session, basics.live).map(r => r.lane),
      )
      if (running.size === 0) return
      const tasks = indexTasks(change.after, readThreads(basics.session))
      const steers = planCanvasFacts({
        before: change.before,
        after: change.after,
        by: change.cause.kind === "host" ? null : change.cause.by,
        threadsOf: tasks.threadsOf,
        running,
        titleOf: titleOf(basics),
        taskTitleOf: task =>
          taskTitle(
            task,
            tasks,
            readMarks(basics.session),
            readRoots(basics.session),
          ),
      })
      if (steers.length === 0) return
      const names = readParticipantNames(basics.session)
      const nameOf = (w: WriterId) => displayName(w, names.get(w))
      // execute, off the command's step
      for (const steer of steers)
        void deps.keeper
          .run(async () => {
            await deps.agent
              .lane(steer.lane)
              .steer(encodeCanvasFact(steer.fact, nameOf, basics.now()))
          })
          .catch(
            failed(
              basics,
              "telling a running thread its canvas changed",
              steer.lane,
            ),
          )
    },
  }
}
