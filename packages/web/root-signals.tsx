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
  detailsTitle,
  moving,
  NO_STATUS_WORDS,
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByCanvas,
  type Signal,
  type Status,
  signalWords,
  statusSignal,
  statusWord,
  statusWords,
  toggleOpenMenu,
  withOpenMenus,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { useMemo, useState } from "react"
import { Button } from "./button.tsx"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, Avatars, nameFor } from "./presence.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { useOthersReading, useReadingCanvases } from "./use-presence.ts"

interface StatusProps {
  status: Status | null
  arrived: number | null
  done: number | null
  nameOf: ReadonlyMap<WriterId, string>
}

/** A root's status, before its label, in the sidebar and on the board (`statusMark`). */
export const RootStatus = (p: StatusProps) => statusMark(p)

/**
 * A status's mark: its level's (a still ring while its agent works, quiet
 * when not raised for you), or a ✓ that fades when a run you follow ended
 * with nothing to do (`statusSignal`); null with nothing to say. Its title
 * says why, when an item raised it. A root's, before its label, and a
 * column's dot draw it alike.
 */
function statusMark({ status, arrived, done, nameOf }: StatusProps) {
  const signal = statusSignal(status, moving(done, Date.now()))
  if (signal === null) return null
  return (
    <SignalMark
      arrived={status === null ? done : arrived}
      quiet={status !== null && !status.raised}
      signal={signal}
      title={titleOf(status, signal, nameOf)}
    />
  )
}

/** A mark's title: its status's (`statusWords`), or its signal's alone, a ✓ fading with none. */
const titleOf = (
  status: Status | null,
  signal: Signal,
  nameOf: ReadonlyMap<WriterId, string>,
): string =>
  status === null || signal === "done"
    ? signalWords(signal)
    : statusWords(status, w => nameFor(nameOf, w))

/**
 * A column's dot, after its name, folded or not: its thread's status
 * (`statusMark`), or a grey dot with nothing to say, so the line keeps its
 * shape.
 */
export function ColumnDot(p: StatusProps) {
  return (
    statusMark(p) ?? (
      <span
        aria-label={NO_STATUS_WORDS}
        className="signal"
        data-signal="none"
        role="img"
        title={NO_STATUS_WORDS}
      />
    )
  )
}

/**
 * A column's status button, after its name, folded or not: its dot, the
 * word a raised status says (`statusWord`; none in a strip, where the title
 * holds it), and a chevron turned while its details are open. `onPress`
 * asks for them (`columnHead`'s `status`).
 */
export function StatusButton(
  p: StatusProps & {
    open: boolean
    /** Its word drawn, not only in its title: the unfolded header's. */
    worded: boolean
    detailsId?: string
    onPress: () => void
  },
) {
  const word = p.worded ? statusWord(p.status) : null
  const why =
    p.status === null
      ? NO_STATUS_WORDS
      : statusWords(p.status, w => nameFor(p.nameOf, w))
  return (
    <Button
      look="plain"
      aria-controls={p.open ? p.detailsId : undefined}
      aria-expanded={p.open}
      className="head-status-button"
      data-level={p.status?.raised === true ? p.status.level : undefined}
      onClick={p.onPress}
      title={`${why}\n${detailsTitle(p.open)}`}
    >
      <ColumnDot {...p} />
      {word !== null && <span className="head-status-word">{word}</span>}
    </Button>
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
