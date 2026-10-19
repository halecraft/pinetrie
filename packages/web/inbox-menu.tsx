// web/inbox-menu — your inbox's menu: in the footer's corner as an icon with
// its badge, and, while the sidebar is folded, inside the account menu
// (`account-menu.tsx`). One hook builds its sections for both. A thread's row
// (`threadRow`) is here too: the board's readers' menus use it.

import {
  type CanvasId,
  type EntryId,
  firstLine,
  messageText,
  type ThreadId,
  type ThreadName,
  type TreeIndex,
} from "@pinetrie/core"
import {
  attentionWords,
  type InboxItem,
  type InboxSection,
  type InboxView,
  type InboxWords,
  type Intent,
  type Item,
  inboxView,
  inboxWords,
  linkWords,
  NOT_NEEDED,
  opens,
  type Reader,
  type ThreadLink,
} from "@pinetrie/interface"
import { readableThreadName } from "@pinetrie/rules"
import { useState } from "react"
import { InboxIcon } from "./icons.tsx"
import { Menu, type MenuItem, type MenuSection } from "./menu.tsx"
import { nameFor } from "./presence.tsx"
import type { InboxSeen } from "./use-inbox.ts"

/**
 * A thread as a menu row: its lane's name when it has one, where its link leads
 * (its canvas's label, or who has it), and the start of the message at `end`;
 * choosing it follows the link (`onOpen`), which a thread someone else holds
 * does not let it.
 */
export function threadRow(input: {
  readonly index: TreeIndex
  readonly labelOf: (canvas: CanvasId | null) => string
  readonly reader: Reader
  readonly onOpen: (id: EntryId, link: ThreadLink) => void
}) {
  return (
    key: string,
    end: EntryId,
    link: ThreadLink,
    name?: string,
    at: string = firstLine(messageText(input.index.entries[end]?.message), 48),
  ): MenuItem => ({
    key,
    className: "here-thread",
    data: { entry: end },
    disabled: !opens(link),
    label: (
      <>
        {name !== undefined && <span className="here-name">{name}</span>}
        <span className="here-root">
          {linkWords(link, input.reader, input.labelOf)}
        </span>
        <span className="here-at">{at}</span>
      </>
    ),
    onChoose: () => input.onOpen(end, link),
  })
}

/** A thread's menu row, as `threadRow` builds it. */
export type ThreadRow = ReturnType<typeof threadRow>

export interface InboxMenuProps {
  readonly attention: readonly Item[]
  readonly count: number
  readonly mentions: readonly InboxItem[]
  readonly inbox: InboxSeen
  readonly thread: ThreadRow
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** Where each thread's link leads (`threadLink`): a raised item or a mention opens there. */
  readonly linkOf: (thread: ThreadId) => ThreadLink
  readonly labelOf: (canvas: CanvasId | null) => string
  readonly reader: Reader
  readonly onOpen: (id: EntryId, link: ThreadLink) => void
  readonly onIntent: (intent: Intent) => void
}

/**
 * Your inbox's menu: what the threads you follow raise for you, then mentions
 * of you. What goes in which section is `inboxView`'s; this turns them into
 * rows. Both the corner's inbox and, while the sidebar is folded, the account
 * menu draw it, so its rows, "not needed", the filter and "mark all seen" are
 * one code path.
 */
export function useInboxMenu({
  attention,
  count,
  mentions,
  inbox,
  thread,
  names,
  linkOf,
  labelOf,
  reader,
  onIntent,
  onOpen,
}: InboxMenuProps): {
  readonly view: InboxView
  readonly words: InboxWords
  /** The heading's, then each section's: the menu's whole sections. */
  readonly sections: readonly MenuSection[]
  /** Keeps the sections shown while the menu is open (`kept`), forgets them as it closes. */
  readonly onToggle: (open: boolean) => void
} {
  const [onlyUnseen, setOnlyUnseen] = useState(false)
  const [kept, setKept] = useState<readonly InboxSection[]>([])
  const { nameOf } = reader
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
        linkOf(item.lane),
        readableThreadName(names, item.lane),
        attentionWords(item.raised, w => nameFor(nameOf, w)),
      ),
      className: `here-thread raised ${item.level}`,
    },
    // An ssh ask clears when its owner answers it, in the column's header.
    ...((item.raised.kind === "ready" && item.raised.source === null) ||
    item.raised.kind === "ssh"
      ? []
      : [
          {
            key: `${item.lane}:${item.raised.kind}:not-needed`,
            className: "not-needed",
            keepOpen: true,
            label: NOT_NEEDED.label,
            title: NOT_NEEDED.title,
            onChoose: () =>
              onIntent({
                kind: "not-needed",
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
  const rows: MenuItem[] = listed.map(m => {
    const link = linkOf(m.thread)
    return {
      key: m.id,
      className: inbox.isUnseen(m.id) ? "inbox-row unseen" : "inbox-row",
      data: { entry: m.id },
      label: (
        <>
          <span className="inbox-who">
            {nameFor(nameOf, m.by)} · {linkWords(link, reader, labelOf)}
          </span>
          <span className="inbox-text">{firstLine(m.text, 48)}</span>
        </>
      ),
      onChoose: () => {
        inbox.markSeen(m.id)
        // A mention opens in the canvas its thread is in, or not at all where
        // someone else holds it.
        onOpen(m.id, link)
      },
    }
  })
  const items = (s: InboxSection): readonly MenuItem[] =>
    s === "mentions"
      ? mentions.length === 0
        ? []
        : [...controls, ...rows]
      : view.items[s].flatMap(raised)
  return {
    view,
    words,
    // The first section only names the menu; each later one is a group.
    sections: [
      { key: "inbox", heading: words.heading, items: [] },
      ...view.sections.map(s => ({
        key: s,
        heading: words.sections[s],
        items: items(s),
      })),
    ],
    onToggle: open => setKept(open ? view.sections : []),
  }
}

/**
 * Your inbox in the corner: an icon, its badge counting what needs you; nothing
 * here animates, and it is drawn even with nothing in it.
 */
export function InboxMenu(props: InboxMenuProps) {
  const { view, words, sections, onToggle } = useInboxMenu(props)
  return (
    <Menu
      className="inbox"
      label={words.label}
      onToggle={onToggle}
      sections={sections}
      title={words.label}
      trigger={
        <>
          <InboxIcon />
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
