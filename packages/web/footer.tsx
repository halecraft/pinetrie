// web/footer — the page's one row of chrome, along its bottom (ADR-0085).
// It splits where your list's edge does: below your list, what is yours (you,
// whose avatar opens your profile, `profile.tsx`; your inbox, `inbox-view.ts`,
// ADR-0091; and your inventory, which moves into your profile while your
// list is folded, ADR-0088, when the inbox stands just past the corner); to
// the right, what is everyone's: the board's strip (`board.tsx`), which
// counts where the agent works and what is ready to accept, then "syncing…"
// while the document is pending and the publish button (ADR-0090). The inbox
// carries the page's only badge. Nothing here opens a root until you choose,
// and nothing closes a menu you opened: an open menu keeps a section whose
// rows have gone, and says so.

import {
  type EntryId,
  firstLine,
  type LaneName,
  type LineRecord,
  messageText,
  type ProjectRecord,
  type ThreadName,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import {
  attentionWords,
  type InboxItem,
  type InboxSection,
  type Intent,
  type Item,
  inboxView,
  inboxWords,
  LEVEL_CLASS,
  publishToast,
  publishView,
  publishWords,
  resolveIntent,
} from "@pinetrie/interface"
import { threadNameOf } from "@pinetrie/rules"
import type { LineActing, SessionClient } from "@pinetrie/session"
import { type ReactNode, useState, useSyncExternalStore } from "react"
import {
  InventoryToggle,
  type InventoryToggleProps,
} from "./inventory-toggle.tsx"
import { Menu, type MenuItem } from "./menu.tsx"
import { nameFor } from "./presence.tsx"
import { type Me, Profile } from "./profile.tsx"
import { Toast } from "./toast.tsx"
import type { InboxSeen } from "./use-inbox.ts"

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

/** A thread's menu row, as `threadRow` builds it. */
export type ThreadRow = ReturnType<typeof threadRow>

export function Footer({
  syncing,
  strip,
  session,
  thread,
  labelOf,
  nameOf,
  colorOf,
  names,
  count,
  attention,
  mentions,
  inbox,
  line,
  project,
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
  /** A thread's row, which opens it (`threadRow`, made once by `App`). */
  thread: ThreadRow
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  /** Each lane's name: a thread's row leads with it (ADR-0039). */
  names: ReadonlyMap<LaneName, ThreadName>
  /** What needs you (`inboxCount`): the inbox's badge, as the window's title has it. */
  count: number
  /** What the threads you follow raise for you (`attentionOf`, ADR-0077). */
  attention: readonly Item[]
  mentions: readonly InboxItem[]
  inbox: InboxSeen
  /** The integration line (ADR-0060), as the host last read it. */
  line: LineRecord | null
  /** Where the host runs: "resolve with the agent" works in its root. */
  project: ProjectRecord | null
  /** Open an entry in your list (`planOpen`). */
  onOpen: (id: EntryId, root: EntryId) => void
  /** Where "not needed" and the publish toast's "resolve with the agent" go. */
  onIntent: (intent: Intent) => void
  /** Your inventory's toggle: whether its panel is open, and its cards. */
  inventory: InventoryToggleProps
  me: Me
  /**
   * Your list is folded to icons (ADR-0088): the corner, as narrow, holds
   * only your avatar, the inventory's toggle is in your profile, and your
   * inbox stands just past the corner.
   */
  folded: boolean
}) {
  const yours = (
    <InboxMenu
      attention={attention}
      count={count}
      inbox={inbox}
      labelOf={labelOf}
      mentions={mentions}
      nameOf={nameOf}
      names={names}
      onIntent={onIntent}
      onOpen={onOpen}
      thread={thread}
    />
  )
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
            {yours}
            <InventoryToggle {...inventory} />
          </>
        )}
      </div>
      {folded && yours}
      {strip}
      <div className="footer-right">
        {syncing && <span className="sync-note">syncing…</span>}
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
 * Your inbox (ADR-0091): what the threads you follow raise for you, then
 * mentions of you, in one menu. Its badge counts what needs you; nothing
 * here animates, and it is drawn even with nothing in it. What goes in
 * which section is `inboxView`'s; this draws it.
 */
function InboxMenu({
  attention,
  count,
  mentions,
  inbox,
  thread,
  names,
  labelOf,
  nameOf,
  onOpen,
  onIntent,
}: {
  attention: readonly Item[]
  count: number
  mentions: readonly InboxItem[]
  inbox: InboxSeen
  thread: ThreadRow
  names: ReadonlyMap<LaneName, ThreadName>
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  onOpen: (id: EntryId, root: EntryId) => void
  onIntent: (intent: Intent) => void
}) {
  const [onlyUnseen, setOnlyUnseen] = useState(false)
  const [kept, setKept] = useState<readonly InboxSection[]>([])
  const view = inboxView({
    items: attention,
    badge: count,
    mentions: mentions.length,
    unseen: inbox.unseen,
    kept,
  })
  const words = inboxWords(view)
  /** A raised item's rows: its thread, with its reason, and "not needed". */
  const raised = (item: Item): MenuItem[] => [
    {
      ...thread(
        `${item.lane}:${item.raised.kind}`,
        item.end,
        item.root,
        threadNameOf(names, item.lane),
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
  const items = (s: InboxSection): readonly MenuItem[] =>
    s === "mentions"
      ? mentions.length === 0
        ? []
        : [...controls, ...rows]
      : view.items[s].flatMap(raised)
  return (
    <Menu
      className="inbox"
      // The first section only names the menu; each later one is a group.
      sections={[
        { key: "inbox", heading: words.heading, items: [] },
        ...view.sections.map(s => ({
          key: s,
          heading: words.sections[s],
          items: items(s),
        })),
      ]}
      label={words.label}
      onToggle={open => setKept(open ? view.sections : [])}
      title={words.label}
      trigger={
        <>
          {words.trigger}
          {view.badge > 0 && (
            <span className="inbox-badge" data-needs-you={view.badge}>
              {view.badge}
            </span>
          )}
        </>
      }
      triggerClassName="inbox-trigger"
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
