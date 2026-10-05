// client/footer — the page's one row of chrome, along its bottom (ADR-0085).
// It splits where your list's edge does: below your list, what is yours (you,
// whose avatar opens your profile, `profile.tsx`, and your inventory, which
// moves into your profile while your list is folded, ADR-0088); to the
// right, what is everyone's: the board's strip (`board.tsx`), then one menu
// of what needs you (`activity.ts`, ADR-0069, ADR-0077), the publish button
// (ADR-0090), and "syncing…" while the document is pending. The
// agent comes from live data (the running lanes), the inbox from the tree
// and your attention document. Nothing here opens a root until you choose,
// and nothing closes a menu you opened: a trigger whose live data has gone
// stays until you close its menu (`Popover`'s `gone`).

import {
  type EntryId,
  firstLine,
  type LineRecord,
  messageText,
  type ProjectRecord,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { LineActing, SessionClient } from "@pinetrie/session"
import { type ReactNode, useState, useSyncExternalStore } from "react"
import {
  type ActivitySection,
  type ActivityView,
  activityView,
  activityWords,
} from "./activity.ts"
import type { OpenOffer } from "./app-view.ts"
import {
  attentionWords,
  type Item,
  LEVEL_CLASS,
  type Level,
} from "./attention.ts"
import { AGENT_MARK } from "./column-view.ts"
import type { RunHere } from "./here.ts"
import type { InboxItem } from "./inbox.ts"
import type { Intent } from "./intent.ts"
import {
  InventoryToggle,
  type InventoryToggleProps,
} from "./inventory-toggle.tsx"
import { Menu, type MenuItem } from "./menu.tsx"
import { nameFor } from "./presence.tsx"
import { type Me, Profile } from "./profile.tsx"
import {
  publishToast,
  publishView,
  publishWords,
  resolveIntent,
} from "./publish-view.ts"
import { Toast } from "./toast.tsx"
import type { InboxView } from "./use-inbox.ts"

/**
 * A thread as a menu row: its lane's name when it has one, its root's label,
 * and the start of the message at `end`; choosing it opens it (`onOpen`).
 */
export function threadRow(input: {
  readonly index: TreeIndex
  readonly labelOf: (root: EntryId) => string
  readonly onOpen: (id: EntryId, root: EntryId) => void
}) {
  return (
    key: string,
    end: EntryId,
    root: EntryId,
    name?: string,
    at: string = firstLine(messageText(input.index.entries[end]?.message), 48),
  ): MenuItem => ({
    key,
    className: "here-thread",
    data: { entry: end },
    label: (
      <>
        {name !== undefined && <span className="here-name">{name}</span>}
        <span className="here-root">{input.labelOf(root)}</span>
        <span className="here-at">{at}</span>
      </>
    ),
    onChoose: () => input.onOpen(end, root),
  })
}

export function Footer({
  syncing,
  strip,
  session,
  runs,
  index,
  labelOf,
  nameOf,
  colorOf,
  mentions,
  inbox,
  offers,
  attention,
  line,
  project,
  names,
  onOpen,
  onIntent,
  inventory,
  me,
  folded,
}: {
  /** The document's status is "pending" (`useDocStatus`). */
  syncing: boolean
  /** The board's strip (`BoardStrip`): everyone's, after what is yours. */
  strip: ReactNode
  session: SessionClient
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
  /** What the threads you follow raise for you (`attentionOf`, ADR-0077). */
  attention: readonly Item[]
  /** The integration line (ADR-0060), as the host last read it. */
  line: LineRecord | null
  /** Where the host runs: "resolve with the agent" works in its root. */
  project: ProjectRecord | null
  /** Each lane's name: a thread's row leads with it (ADR-0039). */
  names: ReadonlyMap<string, string>
  /** Open an entry in your list (`planOpen`). */
  onOpen: (id: EntryId, root: EntryId) => void
  /** Where the publish toast's "resolve with the agent" goes. */
  onIntent: (intent: Intent) => void
  /** Your inventory's toggle: whether its panel is open, and its cards. */
  inventory: InventoryToggleProps
  me: Me
  /**
   * Your list is folded to icons (ADR-0088): the corner, as narrow, holds
   * only your avatar, and the inventory's toggle is in your profile.
   */
  folded: boolean
}) {
  const thread = threadRow({ index, labelOf, onOpen })
  /** A raised item's rows: its thread, with its reason, and "not needed". */
  const raised = (item: Item): MenuItem[] => [
    {
      ...thread(
        `${item.lane}:${item.raised.kind}`,
        item.end,
        item.root,
        names.get(item.lane),
        attentionWords(item.raised, w => nameFor(nameOf, w)),
      ),
      className: `here-thread raised ${LEVEL_CLASS[item.level]}`,
    },
    ...(item.raised.kind === "offer" && item.raised.source === null
      ? []
      : [
          {
            key: `${item.lane}:${item.raised.kind}:not-needed`,
            className: "not-needed",
            keepOpen: true,
            label: "not needed",
            title: "clear it, on every device of yours",
            onChoose: () =>
              onIntent({
                kind: "notNeeded",
                lane: item.lane,
                raised: item.raised,
              }),
          },
        ]),
  ]
  const verdicts = (level: Level): MenuItem[] =>
    attention.flatMap(i =>
      i.raised.kind === "verdict" && i.level === level ? raised(i) : [],
    )
  const yourOffers = new Map(
    attention.flatMap(i => (i.raised.kind === "offer" ? [[i.lane, i]] : [])),
  )
  const verdictsAt = (level: Level) =>
    attention.filter(i => i.raised.kind === "verdict" && i.level === level)
      .length
  const counts = {
    needsYou: verdictsAt("needsYou"),
    ready: offers.length,
    readyYours: yourOffers.size,
    worthARead: verdictsAt("worthARead"),
  }
  return (
    <footer id="bottom">
      <div className="footer-you">
        {folded ? (
          <Profile
            {...me}
            colorOf={colorOf}
            inventory={inventory}
            nameOf={nameOf}
          />
        ) : (
          <>
            <Profile {...me} colorOf={colorOf} nameOf={nameOf} />
            <InventoryToggle {...inventory} />
          </>
        )}
      </div>
      {strip}
      <div className="footer-right">
        {syncing && <span className="sync-note">syncing…</span>}
        <ActivityMenu
          inbox={inbox}
          labelOf={labelOf}
          mentions={mentions}
          nameOf={nameOf}
          counts={counts}
          needsYou={verdicts("needsYou")}
          offers={offers.flatMap(o => {
            const yours = yourOffers.get(o.lane)
            return yours === undefined
              ? [thread(o.lane, o.end, o.root, names.get(o.lane))]
              : raised(yours)
          })}
          worthARead={verdicts("worthARead")}
          onOpen={onOpen}
          runs={runs.map(r => thread(r.lane, r.end, r.root, names.get(r.lane)))}
        />
        <PublishButton
          line={line}
          onIntent={onIntent}
          project={project}
          session={session}
        />
      </div>
    </footer>
  )
}

/**
 * What needs you, in one menu (ADR-0069): threads with work ready to add,
 * mentions of you, and where the agent works. The badge counts the first two;
 * the agent's runs are a steady count beside it. Nothing here animates.
 */
function ActivityMenu({
  counts,
  needsYou,
  offers,
  worthARead,
  runs,
  mentions,
  inbox,
  labelOf,
  nameOf,
  onOpen,
}: {
  /** What each section counts: its threads, not its rows. */
  counts: Pick<ActivityView, "needsYou" | "ready" | "readyYours" | "worthARead">
  /** Rows of the verdicts that need you, each with its "not needed". */
  needsYou: readonly MenuItem[]
  /** A row per thread with an open offer; one you follow with its "not needed". */
  offers: readonly MenuItem[]
  /** Rows of the verdicts worth a read. */
  worthARead: readonly MenuItem[]
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
    ...counts,
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
    needsYou,
    ready: offers,
    worthARead,
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
          {view.badge > 0 && (
            <span className="activity-badge" data-needs-you={view.badge}>
              {view.badge}
            </span>
          )}
        </>
      }
      triggerClassName="activity-trigger"
    />
  )
}

/**
 * The publish button (ADR-0090): set up before the line exists, on the host's
 * own machine; then publish, only while there is something to publish. A
 * refusal or failure of your last command here is a toast until you dismiss
 * it or send another.
 */
function PublishButton({
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
  // Your last command here, kept by the session until your next.
  const acting = useSyncExternalStore(
    session.acting.subscribe,
    session.acting.current,
  ).line
  const [dismissed, setDismissed] = useState<LineActing | null>(null)
  const view = publishView(line)
  const said = acting === dismissed ? null : publishToast(acting)
  const resolve = said?.resolve === true ? resolveIntent(project, line) : null
  const toast =
    said === null ? null : (
      <Toast
        action={
          resolve === null
            ? null
            : {
                label: "resolve with the agent",
                onChoose: () => onIntent(resolve),
              }
        }
        onDismiss={() => setDismissed(acting)}
        text={said.text}
      />
    )
  if (view.kind === "absent" || view.kind === "hidden") return toast
  const words = publishWords(view, acting)
  const waiting = acting?.kind === "sent"
  return (
    <>
      {words.kind === "publish" ? (
        <button
          className="publish-button"
          data-refused={words.refused || undefined}
          disabled={waiting}
          onClick={() => void session.line("publish")}
          title={words.title}
          type="button"
        >
          {words.label}
        </button>
      ) : (
        <Menu
          className="publish-setup"
          label={words.title}
          sections={[
            {
              key: "setup",
              heading: words.heading,
              notes: words.notes,
              items: [
                {
                  key: "setup",
                  className: "setup-action",
                  label: "set up",
                  disabled: waiting,
                  onChoose: () => void session.line("setup"),
                },
              ],
            },
          ]}
          title={words.title}
          trigger={words.label}
          triggerClassName="publish-button"
        />
      )}
      {toast}
    </>
  )
}
