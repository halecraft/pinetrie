// interface/inbox — the messages that mention you, and which you have seen.
//
// The items are derived from each root's directory record, so a mention in a
// root this tab does not hold is in the inbox too; only what you have seen is
// stored, in your attention document, on every device of yours
// (`use-inbox.ts`). `since` is a watermark: every mention at or before it is
// seen, and `seen` holds the ids of later ones you have seen. Entry ids are
// uuidv7, so id order is creation order.

import {
  address,
  type EntryId,
  parseMentions,
  type RootId,
  type RootRecord,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"

/** A message that mentions you. */
export interface InboxItem {
  readonly id: EntryId
  /** The root it is in. */
  readonly root: RootId
  /** The thread it is in, whose canvas it opens in. */
  readonly thread: ThreadId
  readonly by: WriterId
  readonly text: string
}

/**
 * Every chat that names you, newest first: its mentions resolve (`address`)
 * to your display name. Your own messages never mention you. Only sends
 * count, as `RootRecord.mentions` holds only sends: `address` decides who
 * a person's message is for.
 */
export function inboxMentions(input: {
  /** Every root's directory record. */
  readonly roots: Iterable<RootRecord>
  readonly me: WriterId
  /** Your display name as shown (`displayName`, the guest label included). */
  readonly myName: string
  readonly participants: readonly string[]
}): readonly InboxItem[] {
  const out: InboxItem[] = []
  for (const { root, mentions } of input.roots) {
    for (const { id, by, text, thread } of mentions) {
      if (by === input.me) continue
      const { people } = address({
        mentions: parseMentions(text),
        participants: input.participants,
        agents: [],
        agentByDefault: false,
      })
      if (people.includes(input.myName))
        out.push({ id, root, thread, by, text })
    }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** What you have seen: every mention at or before `since`, and `seen` after it. */
export interface Inbox {
  /** An entry id, or `EARLIEST` (`@pinetrie/session`'s `startingSince`). */
  readonly since: string
  readonly seen: readonly string[]
}

export const isUnseen = (inbox: Inbox, id: string): boolean =>
  id > inbox.since && !inbox.seen.includes(id)

/**
 * Move `since` past every mention that is already seen, in id order, and drop
 * ids at or before it from `seen`: the set keeps only the seen mentions above
 * an unseen one.
 */
function compact(inbox: Inbox, items: readonly InboxItem[]): Inbox {
  let { since } = inbox
  const seen = new Set(inbox.seen)
  const above = items
    .map(i => i.id)
    .filter(id => id > since)
    .sort()
  for (const id of above) {
    if (!seen.has(id)) break
    since = id
  }
  return { since, seen: [...seen].filter(id => id > since).sort() }
}

/** Mark `ids` seen. */
export function markSeen(
  inbox: Inbox,
  ids: readonly string[],
  items: readonly InboxItem[],
): Inbox {
  const fresh = ids.filter(id => isUnseen(inbox, id))
  if (fresh.length === 0) return inbox
  return compact({ since: inbox.since, seen: [...inbox.seen, ...fresh] }, items)
}

/** Everything seen: `since` moves to the newest mention, and `seen` empties. */
export function markAllSeen(inbox: Inbox, items: readonly InboxItem[]): Inbox {
  const newest = items.reduce((m, i) => (i.id > m ? i.id : m), inbox.since)
  return newest === inbox.since && inbox.seen.length === 0
    ? inbox
    : { since: newest, seen: [] }
}

/** The unseen mentions drawn in the root you are on: `shown` is its columns' paths. */
export function seenOnScreen(
  inbox: Inbox,
  items: readonly InboxItem[],
  shown: ReadonlySet<string>,
): readonly string[] {
  return items.flatMap(i =>
    shown.has(i.id) && isUnseen(inbox, i.id) ? [i.id] : [],
  )
}

/**
 * The inbox once the mentions drawn in the root you are on are seen, or null
 * when none of them is new: then nothing is written.
 */
export function seenNow(
  inbox: Inbox,
  items: readonly InboxItem[],
  shown: ReadonlySet<string>,
): Inbox | null {
  const drawn = seenOnScreen(inbox, items, shown)
  return drawn.length === 0 ? null : markSeen(inbox, drawn, items)
}
