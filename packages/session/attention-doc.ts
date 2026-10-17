// session/attention-doc — what you have dealt with, in your own attention
// document: how far you have read each thread, what you marked "not needed",
// and the mentions you have seen. Every write waits for `PersonDoc.ready`.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { EntryId, RootRecord, ThreadId, WriterId } from "@pinetrie/core"
import { personDocId } from "@pinetrie/protocol/writers"
import { type Attention, AttentionDoc, readAttention } from "@pinetrie/schema"
import { personDoc } from "./person-doc.ts"
import { NO_READS, type ReadMemory, readStep } from "./read-marks.ts"
import type { Readable } from "./store.ts"

/** Lower than every entry id (a uuidv7): where a person starts in an empty session. */
export const EARLIEST = "0"

/**
 * Where a person with nothing stored starts: the newest entry in
 * the directory, so everything so far is before them and they start with no
 * backlog; `EARLIEST` when the directory is empty.
 */
export function startingSince(roots: Iterable<RootRecord>): string {
  let since = EARLIEST
  for (const { newest } of roots)
    if (newest !== null && newest > since) since = newest
  return since
}

/**
 * The mentions you have seen, as the page's inbox decides them
 * (`@pinetrie/interface`'s `inbox.ts`): every one at or before `since`, and
 * `seen` above it.
 */
export interface SeenMentions {
  readonly since: string
  readonly seen: readonly string[]
}

export interface AttentionStore {
  readonly attention: Readable<Attention>
  /** A column of `lane` follows its end, at `entry`. */
  read(lane: ThreadId, entry: EntryId): void
  /** A column has left its thread's end, or the page is hidden: write every waiting mark. */
  leave(): void
  /** Mark `lane`'s run-end report, of the run `ask` started, "not needed". */
  dismiss(lane: ThreadId, ask: EntryId): void
  /** Mark `lane`'s proposed changes "not needed" while it holds `source`. */
  dismissReady(lane: ThreadId, source: string): void
  /** The mentions seen, as the inbox decided them next. */
  setInbox(next: SeenMentions): void
  dispose(): void
}

export function attentionStore(
  exchange: Exchange,
  me: WriterId,
  host: string,
  /**
   * Where a person with no document starts (`startingSince`): every run-end
   * report and mention up to it was before them. Null until the session's
   * directory has arrived, when no start can be told.
   */
  start: () => string | null,
): AttentionStore {
  const own = personDoc(
    exchange.get(personDocId("attention", me), AttentionDoc),
    host,
    readAttention,
  )
  const doc = own.doc
  let memory: ReadMemory = NO_READS
  let wake: ReturnType<typeof setTimeout> | null = null

  // A first write, once the host's copy shows there is none.
  const begin = () => {
    if (!own.ready() || doc.since() !== "") return
    const from = start()
    if (from === null) return
    batch(doc, d => {
      d.since.set(from)
      d.mentionsSince.set(from)
    })
  }

  const step = (
    next: { lane: ThreadId; entry: EntryId } | null,
    leaving: boolean,
  ) => {
    const out = readStep(memory, {
      stored: own.value.current().read,
      next,
      ready: own.ready(),
      leaving,
      now: Date.now(),
    })
    memory = out.memory
    if (wake !== null) clearTimeout(wake)
    wake =
      out.wake === null
        ? null
        : setTimeout(() => step(null, false), out.wake - Date.now())
    if (out.write.size > 0)
      batch(doc, d => {
        for (const [lane, entry] of out.write) d.read.set(lane, entry)
      })
  }

  const unchanged = own.onChange(() => {
    begin()
    step(null, false)
  })
  begin()

  /** Written only once the host's copy has arrived: a click before then is dropped. */
  const write = (fn: (d: typeof doc) => void) => {
    if (own.ready()) batch(doc, fn)
  }

  return {
    attention: own.value,
    read: (lane, entry) => step({ lane, entry }, false),
    leave: () => step(null, true),
    dismiss: (lane, ask) => write(d => d.dismissed.set(lane, ask)),
    dismissReady: (lane, source) =>
      write(d => d.dismissedReady.set(lane, source)),
    setInbox(next) {
      const stored = own.value.current()
      const seen = new Set(next.seen)
      write(d => {
        if (next.since !== stored.mentionsSince) d.mentionsSince.set(next.since)
        for (const id of stored.seen) if (!seen.has(id)) d.seen.delete(id)
        for (const id of seen) if (!stored.seen.has(id)) d.seen.set(id, true)
      })
    },
    dispose() {
      unchanged()
      own.dispose()
      if (wake !== null) clearTimeout(wake)
    },
  }
}
