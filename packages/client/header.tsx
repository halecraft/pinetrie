// client/header — the right end of the header: who is here, one menu of what
// needs you (`activity.ts`, ADR-0069), the project (ADR-0060, ADR-0061), and
// then your inventory and you (`profile.tsx`). Your tabs are your view; this
// is the rest of the session. People and the agent come from live data
// (presence, the running lanes), the inbox from the tree and this device's
// seen state. Nothing here opens a tab until you choose, and nothing closes a
// menu you opened: a trigger whose live data has gone stays until you close
// its menu (`Popover`'s `gone`).

import {
  type EntryId,
  firstLine,
  type LineRecord,
  messageText,
  type ProjectRecord,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { useMemo, useState, useSyncExternalStore } from "react"
import {
  type ActivitySection,
  activityView,
  activityWords,
} from "./activity.ts"
import type { OpenOffer } from "./app-view.ts"
import { INVENTORY } from "./card-words.ts"
import { AGENT_MARK } from "./column-view.ts"
import {
  type OpenMenus,
  peopleHere,
  type RunHere,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"
import type { InboxItem } from "./inbox.ts"
import type { Intent } from "./intent.ts"
import { lineNote, lineView, lineWords, resolveIntent } from "./line-view.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, nameFor } from "./presence.tsx"
import { type Me, Profile } from "./profile.tsx"
import type { SessionClient } from "./session-view.ts"
import type { InboxView } from "./use-inbox.ts"
import { useReadingAt, useReadingRoots } from "./use-presence.ts"

export function Header({
  session,
  order,
  runs,
  index,
  labelOf,
  nameOf,
  colorOf,
  mentions,
  inbox,
  offers,
  line,
  project,
  names,
  onOpen,
  onIntent,
  inventory,
  me,
}: {
  session: SessionClient
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  /** The agent's running lanes, in any root (`runsHere`). */
  runs: readonly RunHere[]
  index: TreeIndex
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  mentions: readonly InboxItem[]
  inbox: InboxView
  /** Threads with an offer open in your repo, at their lane's tip (ADR-0038). */
  offers: readonly OpenOffer[]
  /** The integration line (ADR-0060), as the host last read it. */
  line: LineRecord | null
  /** Where the host runs: "resolve with the agent" works in its root. */
  project: ProjectRecord | null
  /** Each lane's name: a thread's row leads with it (ADR-0039). */
  names: ReadonlyMap<string, string>
  /** Open an entry as your tab (`planOpen`). */
  onOpen: (id: EntryId, root: EntryId) => void
  /** Where the project menu's "resolve with the agent" goes. */
  onIntent: (intent: Intent) => void
  /** Your inventory's toggle: whether its panel is open, and its cards. */
  inventory: {
    readonly open: boolean
    readonly count: number
    readonly onToggle: () => void
  }
  me: Me
}) {
  /**
   * A thread as a row: its lane's name when it has one, its root's label, and
   * the start of the message at `end`.
   */
  const thread = (
    key: string,
    end: EntryId,
    root: EntryId,
    name?: string,
  ): MenuItem => ({
    key,
    className: "here-thread",
    data: { entry: end },
    label: (
      <>
        {name !== undefined && <span className="here-name">{name}</span>}
        <span className="here-root">{labelOf(root)}</span>
        <span className="here-at">
          {firstLine(messageText(index.entries[end]?.message), 48)}
        </span>
      </>
    ),
    onChoose: () => onOpen(end, root),
  })
  return (
    <div className="header-right">
      <div className="here">
        <People
          colorOf={colorOf}
          index={index}
          nameOf={nameOf}
          order={order}
          session={session}
          thread={thread}
        />
      </div>
      <ActivityMenu
        inbox={inbox}
        labelOf={labelOf}
        mentions={mentions}
        nameOf={nameOf}
        offers={offers.map(o =>
          thread(o.lane, o.end, o.root, names.get(o.lane)),
        )}
        onOpen={onOpen}
        runs={runs.map(r => thread(r.lane, r.end, r.root, names.get(r.lane)))}
      />
      <LineMenu
        line={line}
        onIntent={onIntent}
        project={project}
        session={session}
      />
      <div className="header-tools">
        <button
          aria-pressed={inventory.open}
          className="inventory-toggle"
          onClick={inventory.onToggle}
          title="your inventory: cards you keep for later"
          type="button"
        >
          {INVENTORY} {inventory.count}
        </button>
        <Profile {...me} colorOf={colorOf} nameOf={nameOf} />
      </div>
    </div>
  )
}

/**
 * Who else is here, a person each, with the threads they follow. It reads
 * presence itself, so a presence write redraws this and not the header. A
 * person who leaves while you have their menu open stays, marked gone, until
 * you close it (`withOpenMenus`).
 */
function People({
  session,
  index,
  order,
  nameOf,
  colorOf,
  thread,
}: {
  session: SessionClient
  index: TreeIndex
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  thread: (key: string, end: EntryId, root: EntryId) => MenuItem
}) {
  const [openMenus, setOpenMenus] = useState<OpenMenus>(new Map())
  const reading = useReadingAt(session.presence, session.writer)
  const reportedRoots = useReadingRoots(session.presence)
  const people = useMemo(
    () => peopleHere(reading, index, order, reportedRoots),
    [reading, index, order, reportedRoots],
  )
  return withOpenMenus(people, openMenus).map(({ person: p, gone }, at) => (
    <Menu
      className="here-person"
      gone={gone}
      sections={[
        {
          key: "threads",
          heading: gone
            ? `${nameFor(nameOf, p.writer)} has left`
            : `${nameFor(nameOf, p.writer)} is in`,
          items: p.threads.map(t => thread(t.end, t.end, t.root)),
        },
      ]}
      key={p.writer}
      label={`${nameFor(nameOf, p.writer)}: where they are`}
      onToggle={open =>
        setOpenMenus(m => toggleOpenMenu(m, p.writer, at, open))
      }
      title={nameFor(nameOf, p.writer)}
      trigger={<Avatar colorOf={colorOf} nameOf={nameOf} writer={p.writer} />}
      triggerClassName="here-trigger"
    />
  ))
}

/**
 * What needs you, in one menu (ADR-0069): threads with work ready to add,
 * mentions of you, and where the agent works. The badge counts the first two;
 * the agent's runs are a steady count beside it. Nothing here animates.
 */
function ActivityMenu({
  offers,
  runs,
  mentions,
  inbox,
  labelOf,
  nameOf,
  onOpen,
}: {
  /** A row per thread with an open offer. */
  offers: readonly MenuItem[]
  /** A row per lane the agent works on. */
  runs: readonly MenuItem[]
  mentions: readonly InboxItem[]
  inbox: InboxView
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  onOpen: (id: EntryId, root: EntryId) => void
}) {
  const [onlyUnseen, setOnlyUnseen] = useState(false)
  const [kept, setKept] = useState<readonly ActivitySection[]>([])
  const view = activityView({
    ready: offers.length,
    mentions: mentions.length,
    unseen: inbox.unseen,
    working: runs.length,
    kept,
  })
  const words = activityWords(view)
  const listed = onlyUnseen
    ? mentions.filter(m => inbox.isUnseen(m.id))
    : mentions
  const controls: MenuItem[] = [
    {
      key: "filter",
      className: "inbox-filter",
      keepOpen: true,
      label: onlyUnseen ? "show all" : "show only unseen",
      onChoose: () => setOnlyUnseen(!onlyUnseen),
    },
    {
      key: "all-seen",
      className: "inbox-all-seen",
      disabled: inbox.unseen === 0,
      keepOpen: true,
      label: "mark all seen",
      onChoose: inbox.markAllSeen,
    },
  ]
  const rows: MenuItem[] = listed.map(m => ({
    key: m.id,
    className: inbox.isUnseen(m.id) ? "inbox-row unseen" : "inbox-row",
    data: { entry: m.id },
    label: (
      <>
        <span className="inbox-who">
          {nameFor(nameOf, m.by)} · {labelOf(m.root)}
        </span>
        <span className="inbox-text">{firstLine(m.text, 48)}</span>
      </>
    ),
    onChoose: () => {
      inbox.markSeen(m.id)
      onOpen(m.id, m.root)
    },
  }))
  const items: Record<ActivitySection, readonly MenuItem[]> = {
    ready: offers,
    mentions: mentions.length === 0 ? [] : [...controls, ...rows],
    working: runs,
  }
  return (
    <Menu
      className="activity"
      gone={view.gone}
      // The first section only names the menu; each later one is a group.
      sections={[
        { key: "activity", heading: words.heading, items: [] },
        ...view.sections.map(s => ({
          key: s,
          heading: words.sections[s],
          items: items[s],
        })),
      ]}
      label={words.label}
      onToggle={open => setKept(open ? view.sections : [])}
      title={words.label}
      trigger={
        <>
          <span className="initial agent-mark">{AGENT_MARK}</span>
          {view.working > 0 && (
            <span className="activity-working">{view.working}</span>
          )}
          {view.needsYou > 0 && (
            <span className="activity-badge" data-needs-you={view.needsYou}>
              {view.needsYou}
            </span>
          )}
        </>
      }
      triggerClassName="activity-trigger"
    />
  )
}

/**
 * The project, the integration line (ADR-0060, ADR-0061): set it up, where
 * your files stand against it, and moving work between them. Absent on a
 * host with no lanes of their own.
 */
function LineMenu({
  line,
  project,
  session,
  onIntent,
}: {
  line: LineRecord | null
  project: ProjectRecord | null
  session: Pick<SessionClient, "line" | "acting">
  onIntent: (intent: Intent) => void
}) {
  const view = lineView(line)
  const words = lineWords(view)
  const resolve = resolveIntent(project, view.facts)
  // Your last command here, kept by the session until your next.
  const acting = useSyncExternalStore(
    session.acting.subscribe,
    session.acting.current,
  ).line
  const said = lineNote(acting)
  const waiting = acting?.kind === "sent"
  const actions = words.actions.flatMap(({ action, label }): MenuItem[] => {
    const item = (onChoose: () => void): MenuItem[] => [
      {
        key: action,
        className: "line-action",
        data: { action },
        label,
        disabled: waiting,
        onChoose,
      },
    ]
    if (action !== "resolve") return item(() => void session.line(action))
    return resolve === null ? [] : item(() => onIntent(resolve))
  })
  return (
    <Menu
      className={`line line-${view.state}`}
      gone={view.state === "absent"}
      sections={[
        {
          key: "line",
          heading: words.heading,
          notes: said === null ? words.notes : [said, ...words.notes],
          items: actions,
        },
      ]}
      label={words.label}
      title={words.label}
      trigger={<span className="line-mark">{words.trigger}</span>}
      triggerClassName="line-trigger"
    />
  )
}
