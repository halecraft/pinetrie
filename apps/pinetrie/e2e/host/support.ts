// e2e/host/support — what the host scenarios share: a run's id, the store's
// records, a store that loads one document late, and a message found by its
// text. Positions and starts are `harness.ts`'s.

import type { Store } from "@kyneta/exchange"
import { type EntryId, projectTranscript } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { CONTROL_TOPIC, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import type { RootDocHandle } from "@pinetrie/schema"
import { lineDocPrefix } from "../../host/lines.ts"
import { treeOf } from "../harness.ts"

export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms))
export const runOf = (o: Outcome) => (o.kind === "started" ? o.runId : "")
/**
 * A document's records in a Kyneta store, their payloads' size, and how many
 * hold the whole document (a compaction's), read
 * through the store itself: it owns its SQLite file, so no second connection
 * may read it (S47). The store also holds each client's command Line, which
 * the host does not compact (see `settle`), so callers count one document.
 */
export const storedRecords = async (
  store: Store,
  docId: string,
): Promise<{ records: number; bytes: number; entireties: number }> => {
  let records = 0
  let bytes = 0
  let entireties = 0
  for await (const r of store.loadAll(docId)) {
    records++
    bytes += r.kind === "entry" ? r.payload.data.length : 0
    if (r.kind === "entry" && r.payload.kind === "entirety") entireties++
  }
  return { records, bytes, entireties }
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
 * `store`, with `docId`'s first load taking `ms` longer. Only the first
 * `loadAll` of `docId` waits, which is the exchange's hydration: the startup
 * reads every document's `currentMeta` before the exchange opens
 * (`readStored`, ADR-0096), and a compaction's `loadAll` comes after the
 * hydration. A proxy, so everything else, its seat included, is the store's
 * own.
 */
export const slowToLoad = (store: Store, docId: string, ms: number): Store => {
  let delayed = false
  return new Proxy(store, {
    get(target, key, receiver) {
      if (key === "loadAll")
        return (id: string) => {
          if (id !== docId || delayed) return target.loadAll(id)
          delayed = true
          return (async function* () {
            await sleep(ms)
            yield* target.loadAll(id)
          })()
        }
      const value = Reflect.get(target, key, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
/** A root's size as it stands: what a compacted store should hold. */
export const rootBytes = (doc: RootDocHandle): number =>
  JSON.stringify({
    entries: doc.entries(),
    usageRows: doc.usageRows(),
    values: doc.values(),
    lists: doc.lists(),
    records: doc.records(),
  }).length
/** In `doc`, the id of the message whose text is exactly `text`. */
export const idOfIn = (
  x: Parameters<typeof treeOf>[0],
  text: string,
): EntryId | null => {
  const index = treeOf(x)
  return (
    Object.values(index.entries).find(
      e => projectTranscript(index, e.id).at(-1)?.text === text,
    )?.id ?? null
  )
}
