// client/header — who is here, what the agent is doing, the threads with an
// offer in your repo (ADR-0038), your inbox of mentions (ADR-0030), and you
// (`profile.tsx`). Your tabs are your view; this is the rest of the session.
// People and the agent come from live data (presence, the running lanes), the
// inbox from the tree and this device's seen state. Nothing here opens a tab
// until you choose.

import {
  type AgentRun,
  firstLine,
  messageText,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { useState } from "react"
import { AGENT_MARK } from "./column-view.ts"
import type { PersonHere } from "./here.ts"
import type { InboxItem } from "./inbox.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { Avatar, nameFor } from "./presence.tsx"
import { type Me, Profile } from "./profile.tsx"
import type { InboxView } from "./use-inbox.ts"

export function Header({
  people,
  runs,
  index,
  labelOf,
  nameOf,
  colorOf,
  mentions,
  inbox,
  offers,
  names,
  onOpen,
  me,
}: {
  people: readonly PersonHere[]
  /** The agent's running lanes (`readAgentActivity`). */
  runs: readonly AgentRun[]
  index: TreeIndex
  labelOf: (root: string) => string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  mentions: readonly InboxItem[]
  inbox: InboxView
  /** Threads with an offer open in your repo, at their lane's tip (ADR-0038). */
  offers: readonly { readonly lane: string; readonly tip: string }[]
  /** Each lane's name: a thread's row leads with it (ADR-0039). */
  names: ReadonlyMap<string, string>
  /** Open an entry as your tab (`planOpen`). */
  onOpen: (id: string) => void
  me: Me
}) {
  /**
   * A thread as a row: its lane's name when it has one, its root's label, and
   * the start of the message at `end`.
   */
  const thread = (
    key: string,
    end: string,
    root: string,
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
        {people.map(p => (
          <Menu
            className="here-person"
            heading={`${nameFor(nameOf, p.writer)} is in`}
            items={p.threads.map(t => thread(t.end, t.end, t.root))}
            key={p.writer}
            label={`${nameFor(nameOf, p.writer)}: where they are`}
            title={nameFor(nameOf, p.writer)}
            trigger={
              <Avatar colorOf={colorOf} nameOf={nameOf} writer={p.writer} />
            }
            triggerClassName="here-trigger"
          />
        ))}
        {runs.length > 0 && (
          <Menu
            className="here-agent running"
            heading="The agent is working in"
            items={runs.map(r =>
              thread(
                r.lane,
                r.tip,
                rootOf(index, r.tip) ?? r.tip,
                names.get(r.lane),
              ),
            )}
            label={`the agent is working in ${runs.length} ${runs.length === 1 ? "thread" : "threads"}`}
            title="the agent is working"
            trigger={
              <>
                <span className="initial agent-mark">{AGENT_MARK}</span>
                <span className="here-count">{runs.length}</span>
              </>
            }
            triggerClassName="here-trigger"
          />
        )}
      </div>
      {offers.length > 0 && (
        <Menu
          className="offers"
          heading="Offers in your repo"
          items={offers.map(o =>
            thread(
              o.lane,
              o.tip,
              rootOf(index, o.tip) ?? o.tip,
              names.get(o.lane),
            ),
          )}
          label={`${offers.length} ${offers.length === 1 ? "offer" : "offers"} ready in your repo`}
          title="offers ready to take"
          trigger={
            <>
              <span className="offer-mark">⇣</span>
              <span className="offers-count" data-offers={offers.length}>
                {offers.length}
              </span>
            </>
          }
          triggerClassName="offers-trigger"
        />
      )}
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
  labelOf: (root: string) => string
  nameOf: ReadonlyMap<WriterId, string>
  onOpen: (id: string) => void
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
      heading={
        mentions.length === 0 ? "No one has mentioned you." : "Mentions of you"
      }
      items={mentions.length === 0 ? [] : [...controls, ...rows]}
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
