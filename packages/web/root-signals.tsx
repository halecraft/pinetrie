// web/root-signals — what a root shows wherever it is drawn: in your list
// and on the board (ADR-0077, ADR-0112). Its status before its label (a
// still ring while its agent works, an amber dot when something needs you, a
// dim one when something is worth a read, a ✓ that fades), and the others
// reading in it. Each reads presence itself, so a presence write redraws it
// and not the list or the board (S59).

import type { EntryId, TreeIndex, WriterId } from "@pinetrie/core"
import {
  attentionWords,
  LEVEL_CLASS,
  LEVEL_WORDS,
  type Level,
  moving,
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByRoot,
  type Status,
  toggleOpenMenu,
  withOpenMenus,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { useMemo, useState } from "react"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, Avatars, nameFor } from "./presence.tsx"
import { useReadingAt, useReadingRoots } from "./use-presence.ts"

/** A level's mark: an amber dot, bright for needs you, dim for worth a read. */
export function StatusMark({
  level,
  title,
  arrived,
}: {
  level: Level
  title: string
  /** When it arrived as you watched, or null: it pulses only as it mounts fresh. */
  arrived: number | null
}) {
  return (
    <span
      aria-label={LEVEL_WORDS[level]}
      className={`root-status ${LEVEL_CLASS[level]}`}
      data-arrived={moving(arrived, Date.now()) ? "" : undefined}
      // A new arrival is a new element, so its pulse plays again.
      key={arrived ?? "still"}
      role="img"
      title={title}
    />
  )
}

/**
 * A root's status, before its label (ADR-0077): a still ring while its
 * agent works, its level's mark when something is raised, a ✓ that fades
 * when a run you follow ended with nothing to do.
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
  if (status === null)
    return moving(done, Date.now()) ? (
      <span
        aria-label="the agent has finished"
        className="root-status done"
        key={done ?? "none"}
        role="img"
        title="the agent has finished"
      >
        ✓
      </span>
    ) : null
  if (status.kind === "working")
    return (
      <span
        aria-label="the agent is working"
        className="root-status working"
        role="img"
        title="the agent is working"
      />
    )
  return (
    <StatusMark
      arrived={arrived}
      level={status.kind}
      title={`${LEVEL_WORDS[status.kind]}: ${attentionWords(status.item.raised, w => nameFor(nameOf, w))}`}
    />
  )
}

/** What presence a root's signals read, from `App`. */
export interface ReadersProps {
  session: SessionClient
  index: TreeIndex
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}

/** The people reading now, grouped by person (`peopleHere`). */
function usePeople(p: ReadersProps) {
  const reading = useReadingAt(p.session.presence, p.session.writer)
  const reportedRoots = useReadingRoots(p.session.presence)
  return useMemo(
    () => peopleHere(reading, p.index, p.order, reportedRoots),
    [reading, p.index, p.order, reportedRoots],
  )
}

/** The others reading in any of `roots`, as avatars: a list item's, or a board state's. */
export function Readers(p: ReadersProps & { roots: readonly EntryId[] }) {
  const people = usePeople(p)
  const key = p.roots.join(",")
  const writers = useMemo(() => {
    const byRoot = readersByRoot(people)
    const out: WriterId[] = []
    for (const root of key.split(","))
      for (const w of byRoot.get(root) ?? []) if (!out.includes(w)) out.push(w)
    return out
  }, [people, key])
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The others reading in `root`, each a menu of the threads they read there,
 * a row of which opens it (`thread`). A person who leaves while you have
 * their menu open stays, marked gone, until you close it (`withOpenMenus`).
 */
export function ReaderMenus(
  p: ReadersProps & {
    root: EntryId
    thread: (end: EntryId, root: EntryId) => MenuItem
  },
) {
  const [openMenus, setOpenMenus] = useState<OpenMenus>(new Map())
  const people = usePeople(p)
  const here = useMemo(
    () => peopleIn(people, new Set([p.root])),
    [people, p.root],
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
              items: person.threads.map(t => p.thread(t.end, t.root)),
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
