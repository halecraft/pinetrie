// pi/arrivals — the replica-local arrival index behind pi's `seq`.
//
// `seq` is not stored in the shared document. Each replica numbers items in
// the order it first observes them. pi pages with `cursor.seq + 1`
// (pi-agent-core's `dist/harness/session/session.js`), which is arithmetic
// on a dense integer line: an order that could insert between two issued
// seqs would make a late arrival shift every later item up by one, and a
// cursor would re-read an item already returned.
// Arrival order only ever appends, so cursors are stable by construction.
//
// Invariant: seq is a topological order of the parent DAG (a parent always
// has a lower seq than its children). `scanBranch`'s cursor filter walks
// parents with seq comparisons, so it relies on this.
//
// Nothing about seq is replicated. Each item's identity in the shared document
// is coordination-free:
//     entries    -> id   (uuidv7)
//     usage rows -> id
//     values     -> wid  (unique token per write, peer-tagged)
//     list elems -> eid  (unique token per append, peer-tagged)
//
// Every change to the index is an `Arrival`. A commit and a reconcile each
// produce a `Batch` of them, and `ArrivalIndex.apply` is the one place that
// changes the index.

import type { SessionStats } from "@earendil-works/pi-agent-core"
import type { Usage } from "@earendil-works/pi-ai"
import { orderNewEntries } from "@pinetrie/threads"
import { addUsage, emptyUsage } from "./deep.ts"

export type Arrival =
  | {
      readonly kind: "entry"
      readonly id: string
      readonly seq: number
      readonly message: boolean
    }
  | {
      readonly kind: "usage"
      readonly id: string
      readonly seq: number
      readonly usage: Usage
    }
  | {
      readonly kind: "value"
      readonly pkey: string
      readonly seq: number
      readonly wid: string | undefined
    }
  | {
      readonly kind: "element"
      readonly pkey: string
      readonly eid: string
      readonly seq: number
    }
  | {
      readonly kind: "gone"
      readonly field: "values" | "lists"
      readonly pkey: string
    }

/**
 * `through` is the last seq the batch consumed. It can exceed every arrival's
 * seq: pi gives a delete a seq, and a delete records nothing.
 */
export interface Batch {
  readonly arrivals: readonly Arrival[]
  readonly through: number
}

/** An inclusive seq range; an absent end is open. */
export interface Bounds {
  readonly from?: number
  readonly to?: number
}

export type Order = "asc" | "desc"

/** The first index in ascending `seqs` whose seq is at least `seq`. */
function firstAtLeast(seqs: readonly number[], seq: number): number {
  let lo = 0
  let hi = seqs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((seqs[mid] ?? 0) < seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Ids in ascending seq. Seqs are only ever appended above the last, so a seq
 * range is a contiguous slice that a binary search finds.
 */
export class ArrivalLine {
  readonly #ids: string[] = []
  readonly #seqs: number[] = []
  readonly #seqOf = new Map<string, number>()

  add(id: string, seq: number): void {
    const last = this.#seqs.at(-1)
    if (last !== undefined && seq <= last)
      throw new Error(`Arrival out of order: ${id} at ${seq}, after ${last}`)
    this.#ids.push(id)
    this.#seqs.push(seq)
    this.#seqOf.set(id, seq)
  }

  has(id: string): boolean {
    return this.#seqOf.has(id)
  }

  seqOf(id: string): number | undefined {
    return this.#seqOf.get(id)
  }

  /** `[id, seq]` within `bounds`, in `order`. */
  *walk(order: Order, bounds: Bounds = {}): Generator<[string, number]> {
    const lo = firstAtLeast(this.#seqs, bounds.from ?? Number.NEGATIVE_INFINITY)
    const hi =
      bounds.to === undefined
        ? this.#seqs.length
        : firstAtLeast(this.#seqs, bounds.to + 1)
    for (let n = 0; n < hi - lo; n++) {
      const i = order === "asc" ? lo + n : hi - 1 - n
      const id = this.#ids[i]
      const seq = this.#seqs[i]
      if (id !== undefined && seq !== undefined) yield [id, seq]
    }
  }
}

interface Known {
  readonly lastSeq: number
  hasEntry(id: string): boolean
  hasUsage(id: string): boolean
  /** undefined: not indexed. `{ wid: undefined }`: indexed, written without a token. */
  valueAt(pkey: string): { readonly wid: string | undefined } | undefined
  hasList(pkey: string): boolean
  hasElement(pkey: string, eid: string): boolean
}

/**
 * The document, read for a scope's keys. A value or list mapped to
 * `undefined` is one the document no longer holds.
 */
export interface Observed {
  readonly entries: ReadonlyMap<
    string,
    { readonly parentId: string | null; readonly type: string }
  >
  readonly usage: ReadonlyMap<string, Usage>
  readonly values: ReadonlyMap<
    string,
    { readonly wid: string | undefined } | undefined
  >
  /** Each list's eids, in document order. */
  readonly lists: ReadonlyMap<string, readonly string[] | undefined>
}

const sorted = (keys: Iterable<string>): string[] => [...keys].sort()

/**
 * The arrivals the observed document implies, numbered from
 * `known.lastSeq + 1`: new entries parents first (`orderNewEntries`), then new
 * usage rows, then values whose `wid` is new or that are gone, then new list
 * elements and gone lists. Usage rows, values and lists go in sorted key order.
 * `cycle` lists the entries on a parent cycle, which get no seq.
 */
export function planArrivals(
  observed: Observed,
  known: Known,
): { readonly batch: Batch; readonly cycle: readonly string[] } {
  let seq = known.lastSeq
  const arrivals: Arrival[] = []

  const fresh = [...observed.entries.keys()].filter(id => !known.hasEntry(id))
  const { ordered, unresolved } = orderNewEntries(
    fresh,
    id => observed.entries.get(id)?.parentId,
  )
  for (const id of ordered)
    arrivals.push({
      kind: "entry",
      id,
      seq: ++seq,
      message: observed.entries.get(id)?.type === "message",
    })

  for (const id of sorted(observed.usage.keys())) {
    const usage = observed.usage.get(id)
    if (usage === undefined || known.hasUsage(id)) continue
    arrivals.push({ kind: "usage", id, seq: ++seq, usage })
  }

  for (const pkey of sorted(observed.values.keys())) {
    const now = observed.values.get(pkey)
    const was = known.valueAt(pkey)
    if (now === undefined) {
      if (was !== undefined)
        arrivals.push({ kind: "gone", field: "values", pkey })
    } else if (was === undefined || was.wid !== now.wid)
      arrivals.push({ kind: "value", pkey, seq: ++seq, wid: now.wid })
  }

  for (const pkey of sorted(observed.lists.keys())) {
    const eids = observed.lists.get(pkey)
    if (eids === undefined) {
      if (known.hasList(pkey))
        arrivals.push({ kind: "gone", field: "lists", pkey })
      continue
    }
    for (const eid of eids)
      if (!known.hasElement(pkey, eid))
        arrivals.push({ kind: "element", pkey, eid, seq: ++seq })
  }

  return { batch: { arrivals, through: seq }, cycle: unresolved }
}

/**
 * The local index. Not replicated, and rebuilt from the document on start.
 * `apply` is its only mutator.
 */
export class ArrivalIndex implements Known {
  readonly entries = new ArrivalLine()
  readonly usage = new ArrivalLine()
  readonly #values = new Map<
    string,
    { readonly wid: string | undefined; readonly seq: number }
  >()
  readonly #lists = new Map<string, ArrivalLine>()
  #lastSeq = 0
  #messageCount = 0
  #usageTotal: Usage = emptyUsage()

  get lastSeq(): number {
    return this.#lastSeq
  }

  hasEntry(id: string): boolean {
    return this.entries.has(id)
  }

  hasUsage(id: string): boolean {
    return this.usage.has(id)
  }

  valueAt(
    pkey: string,
  ): { readonly wid: string | undefined; readonly seq: number } | undefined {
    return this.#values.get(pkey)
  }

  list(pkey: string): ArrivalLine | undefined {
    return this.#lists.get(pkey)
  }

  hasList(pkey: string): boolean {
    return this.#lists.has(pkey)
  }

  hasElement(pkey: string, eid: string): boolean {
    return this.#lists.get(pkey)?.has(eid) ?? false
  }

  valueKeys(): MapIterator<string> {
    return this.#values.keys()
  }

  listKeys(): MapIterator<string> {
    return this.#lists.keys()
  }

  stats(): SessionStats {
    return { messageCount: this.#messageCount, usage: this.#usageTotal }
  }

  apply(batch: Batch): void {
    for (const a of batch.arrivals)
      switch (a.kind) {
        case "entry":
          this.entries.add(a.id, a.seq)
          if (a.message) this.#messageCount += 1
          break
        case "usage":
          this.usage.add(a.id, a.seq)
          this.#usageTotal = addUsage(this.#usageTotal, a.usage)
          break
        case "value":
          this.#values.set(a.pkey, { wid: a.wid, seq: a.seq })
          break
        case "element": {
          let line = this.#lists.get(a.pkey)
          if (line === undefined) {
            line = new ArrivalLine()
            this.#lists.set(a.pkey, line)
          }
          line.add(a.eid, a.seq)
          break
        }
        case "gone":
          if (a.field === "values") this.#values.delete(a.pkey)
          else this.#lists.delete(a.pkey)
          break
      }
    this.#lastSeq = Math.max(this.#lastSeq, batch.through)
  }
}
