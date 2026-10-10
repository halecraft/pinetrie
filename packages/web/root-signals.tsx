// web/root-signals — what a root shows wherever it is drawn: in the sidebar
// and on the board (ADR-0077, ADR-0122). Its status before its label, a
// signal's mark (ADR-0126: a still ring while its agent works or cards wait
// for it, never behind a held queue; an amber dot when something needs you,
// a dim one when something is worth a read, a ✓ that fades), and the others
// reading in it. Each reads presence itself, so a presence write redraws it
// and not the list or the board (S59).

import type {
  EntryId,
  TaskId,
  ThreadId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import {
  attentionWords,
  moving,
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByTask,
  type Status,
  signalWords,
  statusSignal,
  toggleOpenMenu,
  withOpenMenus,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { useMemo, useState } from "react"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, Avatars, nameFor } from "./presence.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { useReadingAt, useReadingTasks } from "./use-presence.ts"

/**
 * A root's status, before its label (ADR-0077): a still ring while its
 * agent works, its level's mark when something is raised, a ✓ that fades
 * when a run you follow ended with nothing to do (`statusSignal`).
 */
export function RootStatus({
  status,
  arrived,
  done,
  nameOf,
}: {
  status: Status | null
  arrived: number | null
  done: number | null
  nameOf: ReadonlyMap<WriterId, string>
}) {
  const signal = statusSignal(status, moving(done, Date.now()))
  if (signal === null) return null
  if (status === null || status.kind === "working")
    return (
      <SignalMark arrived={status === null ? done : null} signal={signal} />
    )
  return (
    <SignalMark
      arrived={arrived}
      signal={signal}
      title={`${signalWords(signal)}: ${attentionWords(status.item.raised, w => nameFor(nameOf, w))}`}
    />
  )
}

/** What presence a root's signals read, from `App`. */
export interface ReadersProps {
  session: SessionClient
  index: TreeIndex
  /** Each thread's task: a reader is in the task their thread is in. */
  taskOfThread: ReadonlyMap<ThreadId, TaskId>
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}

/** The people reading now, grouped by person (`peopleHere`). */
function usePeople(p: ReadersProps) {
  const reading = useReadingAt(p.session.presence, p.session.writer)
  const reported = useReadingTasks(p.session.presence)
  return useMemo(
    () =>
      peopleHere(reading, p.index, p.order, {
        taskOfThread: p.taskOfThread,
        reported,
      }),
    [reading, p.index, p.order, p.taskOfThread, reported],
  )
}

/** The others reading in any of `tasks`, as avatars: a list item's, or a board state's. */
export function Readers(p: ReadersProps & { tasks: readonly TaskId[] }) {
  const people = usePeople(p)
  const byTask = useMemo(() => readersByTask(people), [people])
  const writers: WriterId[] = []
  for (const task of p.tasks)
    for (const w of byTask.get(task) ?? [])
      if (!writers.includes(w)) writers.push(w)
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The others reading in `task`, each a menu of the threads they read there,
 * a row of which opens it (`thread`). A person who leaves while you have
 * their menu open stays, marked gone, until you close it (`withOpenMenus`).
 */
export function ReaderMenus(
  p: ReadersProps & {
    task: TaskId
    thread: (end: EntryId, task: TaskId) => MenuItem | null
  },
) {
  const [openMenus, setOpenMenus] = useState<OpenMenus>(new Map())
  const people = usePeople(p)
  const here = useMemo(
    () => peopleIn(people, new Set([p.task])),
    [people, p.task],
  )
  return (
    <span className="readers">
      {withOpenMenus(here, openMenus).map(({ person, gone }, at) => (
        <Menu
          className="reader"
          gone={gone}
          key={person.writer}
          label={`${nameFor(p.nameOf, person.writer)}: where they are`}
          onToggle={open =>
            setOpenMenus(m => toggleOpenMenu(m, person.writer, at, open))
          }
          sections={[
            {
              key: "threads",
              heading: readerHeading(nameFor(p.nameOf, person.writer), gone),
              items: person.threads.flatMap(t => p.thread(t.end, t.task) ?? []),
            },
          ]}
          title={nameFor(p.nameOf, person.writer)}
          trigger={
            <Avatar
              colorOf={p.colorOf}
              nameOf={p.nameOf}
              writer={person.writer}
            />
          }
          triggerClassName="reader-trigger"
        />
      ))}
    </span>
  )
}
