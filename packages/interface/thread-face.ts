// interface/thread-face — a thread's card in your inventory (ADR-0124):
// known at a glance, as a game's inventory shows what it holds: its name and
// banner, its first line, the first line of where it ended, and its status.
// The whole path is its preview's, when it is opened. Pure.

import {
  type BannerRecord,
  blobUrl,
  type EntryId,
  firstLine,
  firstMessageOf,
  indexAsks,
  type LaneView,
  messageText,
  projectSpine,
  promptOf,
  type ThreadId,
  type ThreadName,
  type TreeIndex,
  threadEnd,
} from "@pinetrie/core"

/** A thread's face in a slot. */
export interface ThreadFace {
  readonly kind: "thread"
  readonly thread: ThreadId
  /** Its two-word name; null before it has one. */
  readonly name: ThreadName | null
  /** Its banner's image, null for none (ADR-0039). */
  readonly sprite: string | null
  /** The first line of its first message; "" before it has one (a copy). */
  readonly first: string
  /** The first line of the message it ends at, when that is not its first. */
  readonly last: string | null
  /** Its newest ask was stopped: taking a running thread stops it. */
  readonly stopped: boolean
  /** How many cards wait in its queue, held until it is on a canvas. */
  readonly queued: number
}

/** How long a face's lines are kept. */
const LINE = 40

/** `thread`'s face, from its tree and its asks, its lane, its name and banner. */
export function threadFace(input: {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly banners: ReadonlyMap<ThreadId, BannerRecord>
}): ThreadFace {
  const { thread, index } = input
  // Its first message, not its first entry, which is often a context entry
  // its branch's first run wrote above its prompt (ADR-0125).
  const firstId = firstMessageOf(index, thread)
  const end = threadEnd(index, thread)
  const lane = input.lanes.find(l => l.name === thread)
  const prompt = end === null ? null : promptOf(index, end)
  const line = (id: EntryId | undefined | null) =>
    id === undefined || id === null
      ? ""
      : firstLine(messageText(index.entries[id]?.message), LINE)
  const banner = input.banners.get(thread)
  return {
    kind: "thread",
    thread,
    name: input.names.get(thread) ?? null,
    sprite: banner === undefined ? null : blobUrl(banner.sha),
    first: line(firstId),
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
  sprite: null,
  first: "",
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
 * A thread in your inventory, opened (ADR-0124): its path from its root to
 * its end, its people's and its agent's messages, read only. Its own type,
 * which no composer, dock or queue takes, so a preview cannot send.
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
          node.role === "chat"
            ? [{ id: node.id, who: node.author ?? "someone", text: node.text }]
            : node.role === "assistant" && node.text.trim() !== ""
              ? [{ id: node.id, who: "agent", text: node.text }]
              : [],
        )
  return { kind: "preview", thread, rows }
}
