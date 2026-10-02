// client/header — who is here, what the agent is doing, the threads with an
// offer in your repo (ADR-0038), your inbox of mentions (ADR-0030), and you
// (`profile.tsx`). Your tabs are your view; this is the rest of the session.
// People and the agent come from live data (presence, the running lanes), the
// inbox from the tree and this device's seen state. Nothing here opens a tab
// until you choose, and nothing closes a menu you opened: a trigger whose
// live data has gone stays until you close its menu (`Popover`'s `gone`).

import {
  type AgentRun,
  type EntryId,
  firstLine,
  type LaneName,
  type LineRecord,
  messageText,
  type ProjectRecord,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { useMemo, useState } from "react"
import { AGENT_MARK } from "./column-view.ts"
import {
  type OpenMenus,
  peopleHere,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"
import type { InboxItem } from "./inbox.ts"
import type { Intent } from "./intent.ts"
import {
  lineOutcomeWords,
  lineView,
  lineWords,
  resolveIntent,
} from "./line-view.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, nameFor } from "./presence.tsx"
import { type Me, Profile } from "./profile.tsx"
import type { SessionClient } from "./session-view.ts"
import type { InboxView } from "./use-inbox.ts"
import { useReadingAt } from "./use-presence.ts"

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
  me,
}: {
  session: SessionClient
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  /** The agent's running lanes (`readAgentActivity`). */
  runs: readonly AgentRun[]
  index: TreeIndex
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  mentions: readonly InboxItem[]
  inbox: InboxView
  /** Threads with an offer open in your repo, at their lane's tip (ADR-0038). */
  offers: readonly { readonly lane: LaneName; readonly tip: EntryId }[]
  /** The integration line (ADR-0060), as the host last read it. */
  line: LineRecord | null
  /** Where the host runs: "resolve with the agent" works in its root. */
  project: ProjectRecord | null
  /** Each lane's name: a thread's row leads with it (ADR-0039). */
  names: ReadonlyMap<string, string>
  /** Open an entry as your tab (`planOpen`). */
  onOpen: (id: EntryId) => void
  /** Where the project menu's "resolve with the agent" goes. */
  onIntent: (intent: Intent) => void
  me: Me
}) {
  const working = runs.length > 0
  const offering = offers.length > 0
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
    onChoose: () => onOpen(end),
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
        <Menu
          className={working ? "here-agent running" : "here-agent"}
          gone={!working}
          sections={[
            {
              key: "runs",
              heading: working
                ? "The agent is working in"
                : "The agent has finished",
              items: runs.map(r =>
                thread(
                  r.lane,
                  r.tip,
                  rootOf(index, r.tip) ?? r.tip,
                  names.get(r.lane),
                ),
              ),
            },
          ]}
          label={
            working
              ? `the agent is working in ${runs.length} ${runs.length === 1 ? "thread" : "threads"}`
              : "the agent has finished"
          }
          title={working ? "the agent is working" : "the agent has finished"}
          trigger={
            <>
              <span className="initial agent-mark">{AGENT_MARK}</span>
              {working && <span className="here-count">{runs.length}</span>}
            </>
          }
          triggerClassName="here-trigger"
        />
      </div>
      <Menu
        className="offers"
        gone={!offering}
        sections={[
          {
            key: "offers",
            heading: offering
              ? "Work ready to add to the project"
              : "Nothing left to add to the project.",
            items: offers.map(o =>
              thread(
                o.lane,
                o.tip,
                rootOf(index, o.tip) ?? o.tip,
                names.get(o.lane),
              ),
            ),
          },
        ]}
        label={
          offering
            ? `${offers.length} ${offers.length === 1 ? "thread has" : "threads have"} work ready to add to the project`
            : "nothing left to add to the project"
        }
        title={
          offering
            ? "work ready to add to the project"
            : "nothing left to add to the project"
        }
        trigger={
          <>
            <span className="offer-mark">⇣</span>
            {offering && (
              <span className="offers-count" data-offers={offers.length}>
                {offers.length}
              </span>
            )}
          </>
        }
        triggerClassName="offers-trigger"
      />
      <LineMenu
        line={line}
        onIntent={onIntent}
        project={project}
        session={session}
      />
      <InboxMenu
        inbox={inbox}
        labelOf={labelOf}
        mentions={mentions}
        nameOf={nameOf}
        onOpen={onOpen}
      />
      <Profile {...me} colorOf={colorOf} nameOf={nameOf} />
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
  const people = useMemo(
    () => peopleHere(reading, index, order),
    [reading, index, order],
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

/** `@`: the messages that mention you, and how many you have not seen. */
function InboxMenu({
  mentions,
  inbox,
  labelOf,
  nameOf,
  onOpen,
}: {
  mentions: readonly InboxItem[]
  inbox: InboxView
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  onOpen: (id: EntryId) => void
}) {
  const [onlyUnseen, setOnlyUnseen] = useState(false)
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
      onOpen(m.id)
    },
  }))
  return (
    <Menu
      className="inbox"
      sections={[
        {
          key: "mentions",
          heading:
            mentions.length === 0
              ? "No one has mentioned you."
              : "Mentions of you",
          items: mentions.length === 0 ? [] : [...controls, ...rows],
        },
      ]}
      label={`mentions of you: ${inbox.unseen} unseen`}
      title="mentions of you"
      trigger={
        <>
          @
          {inbox.unseen > 0 && (
            <span className="inbox-count" data-unseen={inbox.unseen}>
              {inbox.unseen}
            </span>
          )}
        </>
      }
      triggerClassName="inbox-trigger"
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
  session: Pick<SessionClient, "line">
  onIntent: (intent: Intent) => void
}) {
  const view = lineView(line)
  const words = lineWords(view)
  const resolve = resolveIntent(project, view.facts)
  // What the last command here said, until the next.
  const [said, setSaid] = useState<string | null>(null)
  const actions = words.actions.flatMap(({ action, label }): MenuItem[] => {
    const item = (onChoose: () => void): MenuItem[] => [
      {
        key: action,
        className: "line-action",
        data: { action },
        label,
        onChoose,
      },
    ]
    if (action !== "resolve")
      return item(() => {
        setSaid(null)
        void session.line(action).then(o => setSaid(lineOutcomeWords(o)))
      })
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
