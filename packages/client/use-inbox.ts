// client/use-inbox — the inbox's imperative shell: what you have seen, kept
// per device and shared by its tabs (ADR-0030). The decisions are `inbox.ts`'s.

import type { TreeIndex } from "@pineta/core"
import { useCallback, useEffect, useState } from "react"
import {
  type Inbox,
  type InboxItem,
  isUnseen,
  markAllSeen,
  markSeen,
  seenNow,
  startInbox,
} from "./inbox.ts"
import type { DeviceState } from "./tab-state.ts"

export interface InboxView {
  readonly unseen: number
  readonly isUnseen: (id: string) => boolean
  readonly markSeen: (id: string) => void
  readonly markAllSeen: () => void
}

export function useInbox({
  store,
  index,
  items,
  shown,
  settled,
}: {
  readonly store: DeviceState<Inbox>
  readonly index: TreeIndex
  readonly items: readonly InboxItem[]
  /** The tab you are on: its columns' paths. */
  readonly shown: ReadonlySet<string>
  /** True once the document has settled (`whenSettled`). */
  readonly settled: boolean
}): InboxView {
  const [inbox, setInbox] = useState<Inbox | null>(() => store.load() ?? null)

  // With nothing stored, start once the document has settled: from a partial
  // index, every mention not yet arrived would count as new (S29).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled && inbox === null) setInbox(store.save(startInbox(index)))
  }, [settled])

  // Another tab of this device saved: take the merged value. Nothing clears
  // the inbox, so a clear keeps what this tab has.
  useEffect(
    () =>
      store.subscribe(value => {
        if (value !== undefined) setInbox(value)
      }),
    [store],
  )

  const save = useCallback(
    (next: Inbox, from: Inbox) => {
      if (next !== from) setInbox(store.save(next))
    },
    [store],
  )

  // A mention drawn in a column of the tab you are on is seen.
  useEffect(() => {
    if (inbox === null) return
    const next = seenNow(inbox, items, shown)
    if (next !== null) save(next, inbox)
  }, [inbox, items, shown, save])

  if (inbox === null)
    return {
      unseen: 0,
      isUnseen: () => false,
      markSeen: () => {},
      markAllSeen: () => {},
    }
  return {
    unseen: items.filter(i => isUnseen(inbox, i.id)).length,
    isUnseen: id => isUnseen(inbox, id),
    markSeen: id => save(markSeen(inbox, [id], items), inbox),
    markAllSeen: () => save(markAllSeen(inbox, items), inbox),
  }
}
