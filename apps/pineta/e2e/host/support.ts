// e2e/host/support — what the host scenarios share: a run's id,
// positions, the store's records, a store that loads one document late, and
// the two ways to start a thread at the root.

import type { Store } from "@kyneta/exchange"
import {
  atEntry,
  type EntryId,
  entryId,
  type Position,
  projectTranscript,
  ROOT,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { CONTROL_TOPIC, SESSION_DOC_ID } from "@pineta/protocol/messages"
import { readTreeIndex } from "@pineta/reads"
import type { SessionDocHandle } from "@pineta/schema"
import { lineDocPrefix } from "../../host/lines.ts"

export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms))
export const runOf = (o: Outcome) => (o.kind === "started" ? o.runId : "")
export const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))
/**
 * A document's records in a Kyneta store, and their payloads' size, read
 * through the store itself: it owns its SQLite file, so no second connection
 * may read it (S47). The store also holds each client's command Line, which
 * the host does not compact (see `settle`), so callers count one document.
 */
export const storedRecords = async (
  store: Store,
  docId: string,
): Promise<{ records: number; bytes: number }> => {
  let records = 0
  let bytes = 0
  for await (const r of store.loadAll(docId)) {
    records++
    bytes += r.kind === "entry" ? r.payload.data.length : 0
  }
  return { records, bytes }
}
/** Whether any of the session's records in `store` holds `text`. */
export const recordsHold = async (
  store: Store,
  text: string,
): Promise<boolean> => {
  for await (const r of store.loadAll(SESSION_DOC_ID))
    if (
      r.kind === "entry" &&
      Buffer.from(r.payload.data as Uint8Array | string)
        .toString("latin1")
        .includes(text)
    )
      return true
  return false
}
/** Every command Line document a store holds. */
export const storedLines = async (store: Store): Promise<string[]> => {
  const ids: string[] = []
  for await (const id of store.listDocIds(lineDocPrefix(CONTROL_TOPIC)))
    ids.push(id)
  return ids
}
/**
 * How late `slowToLoad` makes a load: several times a host's start (12 to
 * 57 ms measured), so a host that does not wait for the load is still seen
 * with the document empty.
 */
export const LATE_LOAD_MS = 300
/**
 * `store`, with `docId`'s first load taking `ms` longer. Kyneta's hydration
 * reads `currentMeta` before `loadAll`, so only the first `currentMeta` of
 * `docId` waits: compaction's `loadAll` and other documents' loads do not. A
 * proxy, so everything else, its seat included, is the store's own.
 */
export const slowToLoad = (store: Store, docId: string, ms: number): Store => {
  let delayed = false
  return new Proxy(store, {
    get(target, key, receiver) {
      if (key === "currentMeta")
        return async (id: string) => {
          if (id === docId && !delayed) {
            delayed = true
            await sleep(ms)
          }
          return target.currentMeta(id)
        }
      const value = Reflect.get(target, key, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
/** A session's size as it stands: what a compacted store should hold. */
export const sessionBytes = (doc: SessionDocHandle): number =>
  JSON.stringify({
    entries: doc.entries(),
    usageRows: doc.usageRows(),
    values: doc.values(),
    lists: doc.lists(),
  }).length
/** In `doc`, the id of the message whose text is exactly `text`. */
export const idOfIn = (doc: SessionDocHandle, text: string): EntryId | null => {
  const index = readTreeIndex(doc)
  return (
    Object.values(index.entries).find(
      e => projectTranscript(index, e.id).at(-1)?.text === text,
    )?.id ?? null
  )
}
/** How the two starts send at the root (ADR-0021). */
export const START_AGENT = { mode: "branch", asksAgent: true } as const
export const START_CHAT = { mode: "branch" } as const
export const BRANCH = { mode: "branch" } as const
