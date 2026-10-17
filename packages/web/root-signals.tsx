// web/root-signals — what a root shows wherever it is drawn: in the sidebar and
// on the board. Its status before its label, a signal's mark (a still ring
// while its agent works or cards wait for it, never behind a held queue; an
// amber dot when something needs you, a dim one when something is worth a read,
// a ✓ that fades), and the others reading in it. Each reads presence itself, so
// a presence write redraws it and not the list or the board.

import type {
  CanvasId,
  EntryId,
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
  readersByCanvas,
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
import { useOthersReading, useReadingCanvases } from "./use-presence.ts"

/**
 * A root's status, before its label: a still ring while its agent works, its
 * level's mark when something is raised, a ✓ that fades when a run you follow
 * ended with nothing to do (`statusSignal`).
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
  /** Each thread's canvas: a reader is in the canvas their thread is in. */
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}

/** The people reading now, grouped by person (`peopleHere`). */
function usePeople(p: ReadersProps) {
  const reading = useOthersReading(p.session.presence, p.session.writer)
  const reported = useReadingCanvases(p.session.presence)
  return useMemo(
    () =>
      peopleHere(reading, p.index, p.order, {
        canvasOfThread: p.canvasOfThread,
        reported,
      }),
    [reading, p.index, p.order, p.canvasOfThread, reported],
  )
}

/** The others reading in any of `canvases`, as avatars: a list item's, or a board state's. */
export function Readers(p: ReadersProps & { canvases: readonly CanvasId[] }) {
  const people = usePeople(p)
  const byCanvas = useMemo(() => readersByCanvas(people), [people])
  const writers: WriterId[] = []
  for (const canvas of p.canvases)
    for (const w of byCanvas.get(canvas) ?? [])
      if (!writers.includes(w)) writers.push(w)
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The others reading in `canvas`, each a menu of the threads they read there,
 * a row of which opens it (`thread`). A person who leaves while you have
 * their menu open stays, marked gone, until you close it (`withOpenMenus`).
 */
export function ReaderMenus(
  p: ReadersProps & {
    canvas: CanvasId
    thread: (end: EntryId, canvas: CanvasId) => MenuItem | null
  },
) {
  const [openMenus, setOpenMenus] = useState<OpenMenus>(new Map())
  const people = usePeople(p)
  const here = useMemo(
    () => peopleIn(people, new Set([p.canvas])),
    [people, p.canvas],
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
              items: person.threads.flatMap(
                t => p.thread(t.end, t.canvas) ?? [],
              ),
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
