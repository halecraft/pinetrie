// client/use-inbox — the inbox's imperative shell: what you have seen, kept
// in your attention document, on every device of yours (ADR-0030,
// ADR-0077). The decisions are `inbox.ts`'s.

import type { AttentionStore } from "@pineta/session"
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import {
  type Inbox,
  type InboxItem,
  isUnseen,
  markAllSeen,
  markSeen,
  seenNow,
} from "./inbox.ts"

export interface InboxView {
  readonly unseen: number
  readonly isUnseen: (id: string) => boolean
  readonly markSeen: (id: string) => void
  readonly markAllSeen: () => void
}

const NOTHING_YET: InboxView = {
  unseen: 0,
  isUnseen: () => false,
  markSeen: () => {},
  markAllSeen: () => {},
}

export function useInbox({
  attention,
  items,
  shown,
}: {
  readonly attention: AttentionStore
  readonly items: readonly InboxItem[]
  /** The tab you are on: its columns' paths. */
  readonly shown: ReadonlySet<string>
}): InboxView {
  const stored = useSyncExternalStore(
    attention.attention.subscribe,
    attention.attention.current,
  )
  // Before your document's first write (`AttentionStore`), where you start
  // is not known, and every mention would count as new.
  const inbox = useMemo<Inbox | null>(
    () =>
      stored.since === ""
        ? null
        : { since: stored.mentionsSince, seen: [...stored.seen].sort() },
    [stored],
  )

  const save = useCallback(
    (next: Inbox, from: Inbox) => {
      if (next !== from) attention.setInbox(next)
    },
    [attention],
  )

  // A mention drawn in a column of the root you are on is seen.
  useEffect(() => {
    if (inbox === null) return
    const next = seenNow(inbox, items, shown)
    if (next !== null) save(next, inbox)
  }, [inbox, items, shown, save])

  if (inbox === null) return NOTHING_YET
  return {
    unseen: items.filter(i => isUnseen(inbox, i.id)).length,
    isUnseen: id => isUnseen(inbox, id),
    markSeen: id => save(markSeen(inbox, [id], items), inbox),
    markAllSeen: () => save(markAllSeen(inbox, items), inbox),
  }
}
