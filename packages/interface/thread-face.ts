// interface/thread-face — a thread's card in your inventory: known at a glance,
// as a game's inventory shows what it holds: its name and icon, its first
// line, what it is doing now, the first line of where it ended, and its
// status. The whole path is its preview's, when it is opened. A thread's
// focus is worded here (`threadFocus`), for its column's header too.

import {
  type EntryId,
  type FocusRecord,
  firstLine,
  indexAsks,
  type LaneView,
  messageText,
  projectSpine,
  runPrompt,
  type ThreadId,
  type ThreadName,
  type TreeIndex,
  threadEnd,
  threadFirstMessage,
} from "@pinetrie/core"
import type { IconLookup, ThreadIcon } from "./thread-icon.ts"

/** A thread's face in a slot. */
export interface ThreadFace {
  readonly kind: "thread"
  readonly thread: ThreadId
  /** Its two-word name; null before it has one. */
  readonly name: ThreadName | null
  /** Its icon (`threadIcon`), null for none. */
  readonly icon: ThreadIcon | null
  /** The first line of its first message; "" before it has one (a copy). */
  readonly first: string
  /** What it is doing now (`threadFocus`), shown above its lines when a model named it. */
  readonly focus: ThreadFocus | null
  /** The first line of the message it ends at, when that is not its first. */
  readonly last: string | null
  /** Its newest ask was stopped: taking a running thread stops it. */
  readonly stopped: boolean
  /** How many cards wait in its queue, held until it is on a canvas. */
  readonly queued: number
}

/** How long a face's lines are kept. */
const LINE = 40

/**
 * What a thread is doing now, as its header, its preview and its folded
 * strip say it: its focus, a model's, or, before a model named one, the
 * first line of how it began (`threadOpening`).
 */
export type ThreadFocus = {
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
export function threadOpening(
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

/** A focus's tooltip: it whole, and, a model's, that a model wrote it. */
export const focusTitle = (focus: ThreadFocus): string =>
  focus.kind === "model" ? `${focus.text}\nwritten by a model` : focus.text

/** `thread`'s face, from its tree and its asks, its lane, its name and icon. */
export function threadFace(input: {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly focuses: ReadonlyMap<ThreadId, FocusRecord>
  readonly iconFor: IconLookup
}): ThreadFace {
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
    focus: threadFocus(input),
    last: end === null || end === firstId ? null : line(end),
    stopped: prompt !== null && indexAsks(index).stoppedBy.has(prompt),
    queued: lane?.waiting ?? 0,
  }
}

/** A thread's face before this tab has read anything of it: its id alone. */
export const bareThreadFace = (thread: ThreadId): ThreadFace => ({
  kind: "thread",
  thread,
  name: null,
  icon: null,
  first: "",
  focus: null,
  last: null,
  stopped: false,
  queued: 0,
})

/** A face's status in words: "stopped · 2 cards queued", or null for nothing to say. */
export function faceStatus(face: ThreadFace): string | null {
  const parts = [
    ...(face.stopped ? ["stopped"] : []),
    ...(face.queued === 0
      ? []
      : [`${face.queued} card${face.queued === 1 ? "" : "s"} queued`]),
  ]
  return parts.length === 0 ? null : parts.join(" · ")
}

/** One message of a preview: who wrote it and what. */
export interface PreviewRow {
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
