// interface/thread-glance — a thread known at a glance, as a game's inventory
// shows what it holds: its name and icon, its first line, what it is doing
// now, the first line of where it ended, and its status. A slot's compact and
// a folded strip read it; the whole path is its preview's, when it is opened.
// What a thread is about is decided here (`threadTitle`, `threadFocus`,
// `threadAbout`), for its column's header too.

import {
  type AgentId,
  type EntryId,
  firstLine,
  isAgentId,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type CardTitleRecord,
  displayName,
  type FocusRecord,
} from "@pinetrie/rules"
import {
  indexAsks,
  type LaneView,
  messageText,
  projectSpine,
  runPrompt,
  type TitledCardId,
  type TreeIndex,
  threadEnd,
  threadFirstMessage,
} from "@pinetrie/threads"
import type { Status } from "./attention.ts"
import type { IconLookup, ThreadIcon } from "./thread-icon.ts"

/** A thread at a glance: what its slot and its folded strip draw. */
export interface ThreadGlance {
  readonly kind: "thread"
  readonly thread: ThreadId
  /** Its two-word name; null before it has one. */
  readonly name: ThreadName | null
  /** Its icon (`threadIcon`), null for none. */
  readonly icon: ThreadIcon | null
  /** The first line of its first message; "" before it has one (a copy). */
  readonly first: string
  /** What it is about (`threadAbout`): its title, else its focus. */
  readonly about: ThreadAbout | null
  /** The first line of the message it ends at, when that is not its first. */
  readonly last: string | null
  /** Its newest ask was stopped: taking a running thread stops it. */
  readonly stopped: boolean
  /** How many cards wait in its queue, held until it is on a canvas. */
  readonly queued: number
  /** Its status (`threadStatus`): what its dot draws; null for none. */
  readonly status: Status | null
}

/** How long a glance's lines are kept. */
const LINE = 40

/**
 * What a thread is doing now, as its header, its preview and its folded
 * strip say it: its focus, a model's, or, before a model named one, the
 * first line of how it began (`threadOpening`).
 */
type ThreadFocus = {
  readonly kind: "model" | "opening"
  readonly text: string
}

/** How long a focus's opening line is kept. */
const OPENING = 120

/**
 * The first line of `thread`'s first message: its first message, not its
 * first entry, which is often a context entry its branch's first run wrote
 * above its prompt. "" before it has one.
 */
function threadOpening(
  index: TreeIndex,
  thread: ThreadId,
  length = OPENING,
): string {
  const id = threadFirstMessage(index, thread)
  return id === null
    ? ""
    : firstLine(messageText(index.entries[id]?.message), length)
}

/** `thread`'s focus: the one place its words are decided. */
export function threadFocus(input: {
  readonly focuses: ReadonlyMap<ThreadId, FocusRecord>
  readonly index: TreeIndex
  readonly thread: ThreadId
}): ThreadFocus | null {
  const record = input.focuses.get(input.thread)
  if (record !== undefined) return { kind: "model", text: record.focus }
  const opening = threadOpening(input.index, input.thread)
  return opening === "" ? null : { kind: "opening", text: opening }
}

/** A thread's title: a person's words for it, shown instead of its focus while set. */
export interface ThreadTitle {
  readonly title: string
  /** Who set it; `planMark` refuses the agent, though a stored record may name it. */
  readonly by: WriterId | AgentId
}

/** `thread`'s title, from its card's title record; null while untitled. */
export function threadTitle(
  titles: ReadonlyMap<TitledCardId, CardTitleRecord>,
  thread: ThreadId,
): ThreadTitle | null {
  const record = titles.get(thread)
  return record === undefined ? null : { title: record.title, by: record.by }
}

/** What a reader is shown of a thread: its title while it has one, else its focus. */
export type ThreadAbout =
  | { readonly kind: "title"; readonly title: ThreadTitle }
  | { readonly kind: "focus"; readonly focus: ThreadFocus }

/** `thread`'s title, else its focus (`threadFocus`); null for neither. */
export function threadAbout(input: {
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  readonly focuses: ReadonlyMap<ThreadId, FocusRecord>
  readonly index: TreeIndex
  readonly thread: ThreadId
}): ThreadAbout | null {
  const title = threadTitle(input.titles, input.thread)
  if (title !== null) return { kind: "title", title }
  const focus = threadFocus(input)
  return focus === null ? null : { kind: "focus", focus }
}

/** Which words a reader is shown of a thread: a title, a model's focus, or the opening line. */
export const aboutKind = (about: ThreadAbout): "title" | ThreadFocus["kind"] =>
  about.kind === "title" ? "title" : about.focus.kind

/** The words of what a reader is shown of a thread. */
export const aboutText = (about: ThreadAbout): string =>
  about.kind === "title" ? about.title.title : about.focus.text

/**
 * The tooltip of what a reader is shown: the words whole, then who wrote
 * them: the person who set a title, or a model for a model's focus.
 */
export function aboutTooltip(
  about: ThreadAbout,
  nameOf: ReadonlyMap<WriterId, string>,
): string {
  if (about.kind === "title") {
    const { title, by } = about.title
    const who = isAgentId(by) ? "the agent" : displayName(by, nameOf.get(by))
    return `${title}\nset by ${who}`
  }
  const { focus } = about
  return focus.kind === "model"
    ? `${focus.text}\nwritten by a model`
    : focus.text
}

/** `thread`'s glance, from its tree and its asks, its lane, its name and icon. */
export function threadGlance(input: {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  readonly focuses: ReadonlyMap<ThreadId, FocusRecord>
  readonly iconFor: IconLookup
  /** Each thread's status (`threadStatus`). */
  readonly statuses: ReadonlyMap<ThreadId, Status>
}): ThreadGlance {
  const { thread, index } = input
  const firstId = threadFirstMessage(index, thread)
  const end = threadEnd(index, thread)
  const lane = input.lanes.find(l => l.name === thread)
  const prompt = end === null ? null : runPrompt(index, end)
  const line = (id: EntryId | undefined | null) =>
    id === undefined || id === null
      ? ""
      : firstLine(messageText(index.entries[id]?.message), LINE)
  return {
    kind: "thread",
    thread,
    name: input.names.get(thread) ?? null,
    icon: input.iconFor(thread),
    first: threadOpening(index, thread, LINE),
    about: threadAbout(input),
    last: end === null || end === firstId ? null : line(end),
    stopped: prompt !== null && indexAsks(index).stoppedBy.has(prompt),
    queued: lane?.waiting ?? 0,
    status: input.statuses.get(thread) ?? null,
  }
}

/** A thread's glance before this tab has read anything of it: its id alone. */
export const bareThreadGlance = (thread: ThreadId): ThreadGlance => ({
  kind: "thread",
  thread,
  name: null,
  icon: null,
  first: "",
  about: null,
  last: null,
  stopped: false,
  queued: 0,
  status: null,
})

/** A glance's status in words: "stopped · 2 cards queued", or null for nothing to say. */
export function glanceStatus(glance: ThreadGlance): string | null {
  const parts = [
    ...(glance.stopped ? ["stopped"] : []),
    ...(glance.queued === 0
      ? []
      : [`${glance.queued} card${glance.queued === 1 ? "" : "s"} queued`]),
  ]
  return parts.length === 0 ? null : parts.join(" · ")
}

/** One message of a preview: who wrote it and what. */
interface PreviewRow {
  readonly id: EntryId
  readonly who: string
  readonly text: string
}

/**
 * A thread in your inventory, opened: its path from its root to its end, its
 * people's and its agent's messages, read only. Its own type, which no
 * composer, dock or queue takes, so a preview cannot send.
 */
export interface ThreadPreview {
  readonly kind: "preview"
  readonly thread: ThreadId
  readonly rows: readonly PreviewRow[]
}

/** `thread`'s path as its preview reads it; empty before the tab holds its tree. */
export function threadPreview(
  thread: ThreadId,
  index: TreeIndex,
  anchor: EntryId | null,
): ThreadPreview {
  const end = threadEnd(index, thread) ?? anchor
  const rows =
    end === null
      ? []
      : projectSpine(index, end).spine.flatMap((node): PreviewRow[] =>
          node.role === "person"
            ? [{ id: node.id, who: node.author ?? "someone", text: node.text }]
            : node.role === "assistant" && node.text.trim() !== ""
              ? [{ id: node.id, who: "agent", text: node.text }]
              : [],
        )
  return { kind: "preview", thread, rows }
}
