// interface/inbox-view — your inbox, under the sidebar beside your avatar, or
// in the menu your avatar opens while the sidebar is folded: how the threads
// you follow ended, their changes ready to accept, what is worth a read, and
// mentions of you. It lists exactly what it counts: the badge is what needs you
// (`inboxCount`), the one count the window's title shows too. Decided as a
// value (`inboxView`) and worded in one function (`inboxWords`). Everyone's
// facts (where the agent works, which roots have work ready) are the board's,
// not here.

import type { Item } from "./attention.ts"
import { count } from "./counts.ts"

/** The inbox's groups, in the order they are drawn. */
export type InboxSection = "needsYou" | "ready" | "worthARead" | "mentions"

/** A group of the threads you follow: every section but the mentions. */
export type ThreadSection = Exclude<InboxSection, "mentions">

const ORDER: readonly InboxSection[] = [
  "needsYou",
  "ready",
  "worthARead",
  "mentions",
]

/** A run-end report goes under its level; proposed changes, under ready. */
const sectionOf = (item: Item): ThreadSection =>
  item.raised.kind === "ready" ? "ready" : item.level

/**
 * What needs you: the inbox's badge and the window's title (`pageTitle`).
 * The items that need you, proposed changes of a thread you follow among them,
 * once, and unseen mentions; never what is worth a read.
 */
export const inboxCount = (items: readonly Item[], unseen: number): number =>
  items.filter(i => i.level === "needsYou").length + unseen

export interface InboxView {
  /** `inboxCount`, as given. */
  readonly badge: number
  /** Each thread section's items, in `attentionItems`'s order. */
  readonly items: Readonly<Record<ThreadSection, readonly Item[]>>
  /** Mentions of you, seen or not. */
  readonly mentions: number
  readonly unseen: number
  /** Each section with rows, or kept because the menu is open on it. */
  readonly sections: readonly InboxSection[]
}

export function inboxView(input: {
  /** What the threads you follow raise for you (`attentionItems`). */
  readonly items: readonly Item[]
  readonly badge: number
  readonly mentions: number
  readonly unseen: number
  /**
   * The sections shown when the menu opened, empty while it is closed: an
   * open menu keeps them until you close it.
   */
  readonly kept: readonly InboxSection[]
}): InboxView {
  const items: Record<ThreadSection, Item[]> = {
    needsYou: [],
    ready: [],
    worthARead: [],
  }
  for (const item of input.items) items[sectionOf(item)].push(item)
  const rows = (s: InboxSection): number =>
    s === "mentions" ? input.mentions : items[s].length
  return {
    badge: input.badge,
    items,
    mentions: input.mentions,
    unseen: input.unseen,
    sections: ORDER.filter(s => rows(s) > 0 || input.kept.includes(s)),
  }
}

export interface InboxWords {
  /** The trigger's accessible name and title: an icon has no words of its own. */
  readonly label: string
  /** The menu's own heading. */
  readonly heading: string
  /** Each section's heading: what it lists, or that it has emptied. */
  readonly sections: Readonly<Record<InboxSection, string>>
}

/** The inbox's name: its trigger's label leads with it, and the account menu's item is it. */
export const INBOX = "Inbox"

/**
 * What clears a raised item on every device of yours, wherever it is offered:
 * an inbox row, and a canvas's ⋯ in the sidebar, whose title names the canvas.
 */
export const NOT_NEEDED = {
  label: "Dismiss",
  title: "clear it, on every device of yours",
  canvasTitle: "clear this canvas's mark, on every device of yours",
} as const

export function inboxWords(view: InboxView): InboxWords {
  const { badge, mentions, unseen } = view
  const needsYou = view.items.needsYou.length
  const ready = view.items.ready.length
  const worthARead = view.items.worthARead.length
  const what = [
    ...(needsYou > 0
      ? [count(needsYou, "answer waiting", "answers waiting")]
      : []),
    ...(ready > 0 ? [`${ready} ready to accept`] : []),
    ...(unseen > 0 ? [count(unseen, "unseen mention", "unseen mentions")] : []),
  ]
  const needs =
    badge === 0
      ? "nothing needs you"
      : `${count(badge, "thing needs", "things need")} you`
  return {
    label: `${INBOX} · ${what.length === 0 ? needs : `${needs}: ${what.join(", ")}`}`,
    heading: badge === 0 ? "Nothing needs you" : needs,
    sections: {
      needsYou: needsYou > 0 ? "Needs you" : "Nothing needs you now.",
      ready: ready > 0 ? "Ready to accept" : "Nothing left to accept.",
      worthARead: worthARead > 0 ? "Worth a read" : "Nothing left to read.",
      mentions: mentions > 0 ? "Mentions of you" : "No one has mentioned you.",
    },
  }
}
