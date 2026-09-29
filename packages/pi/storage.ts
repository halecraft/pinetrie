// pi/storage — our implementation of pi's `Storage` port, over a Kyneta doc.
//
// Promoted from sandbox/s1-seq/kyneta-storage-seq.mjs, which passes pi's own
// 21-case conformance suite. Changes from the spike are confined to wiring:
//   - pi is imported by package specifier (the install is symlinked into
//     node_modules) instead of an absolute filesystem path;
//   - the document shape lives in schema/, so this file no longer defines it;
//   - the caller supplies the doc, because the host replicates that same doc.
// The seq logic below is unchanged.
//
// THE DESIGN, in one sentence (ADR-0013):
//   `seq` is no longer stored in the shared CRDT. It is a REPLICA-LOCAL
//   ARRIVAL INDEX, derived from the document, assigned in the order this
//   replica first OBSERVES each item.
//
// Why arrival order and not causal order (the crux of S1):
//   pi's `findEntries` turns a cursor into `fromSeq: cursor.seq + 1`
//   (session.js:242). That is arithmetic on a dense integer line. Any order
//   that can INSERT BETWEEN two already-issued positions breaks pagination:
//   a late-arriving entry that sorts earlier shifts every later entry up by
//   one, so `cursor.seq + 1` re-reads an entry already returned.
//   Arrival order cannot insert in the middle: a newly observed item always
//   gets a position at the END. Cursors are therefore stable by construction.
//
// Invariant maintained: seq is a TOPOLOGICAL LINEAR EXTENSION of the parent
// DAG (a parent always has a lower seq than its children). `scanBranch`
// filters its parent-walk with seq comparisons, so this is load-bearing.
//
// Nothing about seq is replicated. Per-item identity in the shared doc is
// coordination-free:
//     entries    -> id   (uuidv7, ADR-0009)
//     usage rows -> id
//     values     -> wid  (unique token per write, peer-tagged)
//     list elems -> eid  (unique token per append, peer-tagged)

import type {
  CommitResult,
  Context,
  Entry,
  EntryScan,
  EntryStructure,
  ListElement,
  ListReadOptions,
  SessionStats,
  Storage,
  StorageBranchScan,
  StoredValue,
  UsageRow,
  UsageScan,
  Value,
  ValueList,
  Write,
} from "@earendil-works/pi-agent-core"
import {
  prepareStorageCommit,
  resolveListReadOptions,
  validateCommittedWrites,
  value,
} from "@earendil-works/pi-agent-core"
// `Usage` is pi-ai's type; pi-agent-core re-uses it but does not re-export it.
import type { Usage } from "@earendil-works/pi-ai"
import { batch, type Segment, subscribe } from "@kyneta/schema"
import { orderNewEntries, tailEdit } from "@pineta/core"
import {
  applyTextEdits,
  newSessionDoc,
  physicalKey,
  type SessionDocHandle,
  type StoredEntryRow,
} from "@pineta/schema"
import {
  CHECKPOINT_NAMESPACE,
  sealCheckpoint,
  unsealCheckpoint,
} from "./checkpoint.ts"
import { addUsage, emptyUsage } from "./deep.ts"

// pi orders value keys by Unicode CODE POINT, not UTF-16 code unit.
function compareKeys(left: string, right: string): number {
  const l = Array.from(left, c => c.codePointAt(0) ?? 0)
  const r = Array.from(right, c => c.codePointAt(0) ?? 0)
  const n = Math.min(l.length, r.length)
  for (let i = 0; i < n; i++) {
    const d = (l[i] ?? 0) - (r[i] ?? 0)
    if (d !== 0) return d
  }
  return l.length - r.length
}

/**
 * The coordinate of a changefeed path segment, when it is a string key.
 *
 * `coord()` is the documented accessor — Kyneta's `Segment` interface states it
 * is the one to use for "identity `key`, schema/position walks" and that it is
 * total and never throws, unlike `resolve()`. The pre-TypeScript code read
 * `seg.key`, an implementation detail that exists on the runtime object but is
 * NOT on the published interface. That would have failed silently if Kyneta
 * ever stopped materialising the field: `field` becomes `undefined`, every
 * change falls into the catch-all branch, and reconcile degrades from O(delta)
 * to O(document) on every remote change — slow, not wrong, so nothing would
 * have alerted us. The type checker caught it.
 */
const asKey = (segment: Segment | undefined): string | undefined => {
  if (segment === undefined) return undefined
  const coord = segment.coord()
  return typeof coord === "string" ? coord : undefined
}

/** Narrow a changefeed op to the map set/delete shape we act on. */
function asMapChange(
  change: unknown,
): { set?: Record<string, unknown>; delete?: string[] } | undefined {
  if (change === null || typeof change !== "object") return undefined
  const c = change as { type?: unknown; set?: unknown; delete?: unknown }
  if (c.type !== "map") return undefined
  return {
    set:
      c.set !== null && typeof c.set === "object"
        ? (c.set as Record<string, unknown>)
        : undefined,
    delete: Array.isArray(c.delete) ? (c.delete as string[]) : undefined,
  }
}

/** What a replayed change leaves to re-index: pi's four fields, by key. */
export type Dirty =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "usage" }
  | {
      readonly kind: "entries" | "values" | "lists"
      readonly keys: readonly string[] | "all"
    }

/**
 * Which of pi's indexes a replayed change can invalidate. Pure.
 *
 * Only pi's four fields back its `Storage` port, so only they are re-indexed;
 * every other root field (streams, runs, checkpoint text, and any added later)
 * is ignored. A change with no field replaces the whole document. The keys a
 * map change sets or deletes are re-indexed alone; a change of another shape
 * re-indexes the whole field. Kyneta's change union is broad, so only the
 * leading path segment and a map's keys are read. The ignore list this replaced
 * had to name every non-pi field, so a field it missed re-indexed everything.
 */
export function dirtyFrom(
  segments: readonly Segment[],
  change: unknown,
): Dirty {
  const field = asKey(segments[0])
  if (field === undefined) return { kind: "all" }
  if (field === "usageRows") return { kind: "usage" }
  if (field !== "entries" && field !== "values" && field !== "lists")
    return { kind: "none" }
  // A write inside one list (`lists[key]…`) names its key in the path.
  const inList = field === "lists" ? asKey(segments[1]) : undefined
  if (inList !== undefined) return { kind: "lists", keys: [inList] }
  const ch = asMapChange(change)
  // Entries are only ever added (ADR-0004), so a change that sets none of them
  // is unexpected, and re-indexes them all. Values and lists are re-indexed by
  // the keys set or deleted.
  if (field === "entries")
    return ch?.set === undefined
      ? { kind: "entries", keys: "all" }
      : { kind: "entries", keys: Object.keys(ch.set) }
  if (ch === undefined || (ch.set === undefined && ch.delete === undefined))
    return { kind: field, keys: "all" }
  return {
    kind: field,
    keys: [...Object.keys(ch.set ?? {}), ...(ch.delete ?? [])],
  }
}

let tokenCounter = 0
const makeToken = (peer: string): string =>
  `${peer}-${(tokenCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * What we put in the doc's `values` record. The doc stores `Schema.any()`, so
 * the substrate cannot describe this — but WE own the shape, so it is written
 * down here rather than spread as inline casts. `wid` is the write token whose
 * change signals a newer write won the LWW race (ADR-0013 arrival indexing).
 */
interface StoredValueRecord {
  namespace: string
  key: string
  value: unknown
  wid: string
  /**
   * A tool-output checkpoint stored in two parts: `value` is its shell, and its
   * text is in `checkpointText` under the same physical key (S22).
   */
  sealed?: true
}

/** One element of a stored list. `eid` is the per-append identity token. */
interface StoredListElement {
  eid: string
  value: unknown
}

/**
 * pi's `Entry` minus `seq`. An IN-MEMORY shape, not the stored one.
 * `StoredEntryRow` is what sits in the document (ADR-0015).
 */
/**
 * `Omit` over a union collapses it to the keys common to every member, which
 * for pi's `Entry` discards `message`, `summary`, `fromId` and the rest. The
 * conditional distributes over the union instead, so each variant keeps its
 * own fields. Distribution needs a naked type parameter, hence the helper.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type EntryWithoutSeq = DistributiveOmit<Entry, "seq">

/**
 * The columns `StoredEntryRow` hoists out of the entry. Listed once, so the
 * split and the rejoin cannot disagree about which keys are columns.
 */
const HOISTED = ["id", "parentId", "type", "timestamp", "fromId"] as const

/**
 * Keys `payload` must never carry: the hoisted columns, plus `seq`.
 *
 * `seq` needs naming here even though the write path already strips it. The
 * columns are typed, so an undeclared key cannot reach them \u2014 but `payload` is
 * `Schema.any()`, and a `seq` that got in there WOULD persist and replicate,
 * which is precisely what ADR-0013 forbids. The typed schema makes the rule
 * structural for the columns only; this list is what makes it hold for the
 * payload. A test asserts both halves.
 */
const NEVER_IN_PAYLOAD: readonly string[] = [...HOISTED, "seq"]

/**
 * Entry -> the row we persist (ADR-0015).
 *
 * `payload` carries the variant data and ONLY that. Putting the whole entry in
 * it would give `parentId` two homes, and nothing would keep them equal:
 * `#reconcile` orders arrivals from the column while a renderer could read the
 * blob. A round-trip test cannot detect that, because rejoining from either
 * copy yields the same entry. The guard is the disjointness case in
 * `storage.test.ts`.
 */
export function toStoredRow(entry: EntryWithoutSeq): StoredEntryRow {
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(entry)) {
    if (!NEVER_IN_PAYLOAD.includes(k)) payload[k] = v
  }
  return {
    id: entry.id,
    parentId: entry.parentId,
    type: entry.type,
    timestamp: entry.timestamp,
    // `fromId` exists only on `branch_summary`, so the discriminant narrows it
    // rather than a cast. If pi ever renames or drops that variant, this
    // comparison stops type-checking, which is the warning we want.
    // Absent and null are different facts: the column records null and
    // `fromStoredRow` restores absence.
    fromId: entry.type === "branch_summary" ? entry.fromId : null,
    payload,
  }
}

/**
 * Row -> pi's `Entry`, identical to what pi wrote.
 *
 * `seq` is supplied by the caller rather than read from the row: it is a
 * replica-local arrival index (ADR-0013) and never lives in the document.
 * Passing it here keeps the pairing with `toStoredRow` visible in the type.
 *
 * The return needs a double cast, because a union member cannot be built from
 * a dynamic object. What that cast actually trusts is narrower than it looks:
 *
 *   - the COLUMNS are typed by the Kyneta schema, and a row from a peer on a
 *     different build materializes missing fields as schema defaults rather
 *     than as garbage (measured in S17/P1c), so they are well-formed.
 *   - the WRITE path is checked by pi's own `validateCommittedWrites`.
 *   - `payload` is unchecked, and is not checkable here. pi ships no schema
 *     for `Entry` \u2014 its typebox use is for tool parameters \u2014 so validating it
 *     would mean hand-writing a copy of pi's shape in this repository, which
 *     is the coupling ADR-0015 exists to avoid.
 *
 * So the residual is provenance for `payload`, which is ADR-0015's open
 * question, not a defect in this function.
 */
export function fromStoredRow(row: StoredEntryRow, seq: number): Entry {
  const rebuilt: Record<string, unknown> = {
    ...(row.payload as Record<string, unknown>),
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    timestamp: row.timestamp,
    seq,
  }
  // Restore absence: a message entry never carried `fromId` at all.
  if (row.fromId !== null) rebuilt.fromId = row.fromId
  return rebuilt as unknown as Entry
}

/** A usage row as stored: pi's `UsageRow` minus the never-stored `seq`. */
type StoredUsageRow = Omit<UsageRow, "seq">

export interface KynetaStorageOptions {
  readonly doc?: SessionDocHandle
  readonly peerId?: string
  readonly now?: () => number
}

/**
 * `implements Storage` is the point of this annotation: pi's own interface now
 * checks all eleven methods at compile time. The 21-case conformance suite
 * proves the behaviour; this proves the shape, and catches a signature drift on
 * a pi upgrade before the suite is even run.
 */
export class KynetaStorage implements Storage {
  #doc: SessionDocHandle
  #now: () => number
  #peer: string
  #commitQueue: Promise<unknown> = Promise.resolve()
  #state: "open" | "closing" | "closed" = "open"
  #closePromise: Promise<void> | undefined
  #unsubscribe: (() => void) | undefined

  // ---- the derived local index (NOT replicated) --------------------------
  #seq = 0 // last assigned seq; next is #seq + 1
  #entrySeq = new Map<string, number>() // id -> seq
  #entryOrder: string[] = [] // ids, ascending seq (append-only)
  #usageSeq = new Map<string, number>() // id -> seq
  #usageOrder: string[] = []
  #valueSeq = new Map<string, { wid: string; seq: number }>()
  #listSeq = new Map<string, Map<string, number>>() // pkey -> eid -> seq
  #messageCount = 0
  #usageTotal: Usage = emptyUsage()

  // dirty scopes collected from the changefeed
  #dirtyEntryKeys = new Set<string>()
  #dirtyEntriesAll = false
  #dirtyUsage = false
  #dirtyValueKeys = new Set<string>()
  #dirtyValuesAll = false
  #dirtyListKeys = new Set<string>()
  #dirtyListsAll = false

  constructor(options: KynetaStorageOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#peer = options.peerId ?? "p"
    this.#doc = options.doc ?? newSessionDoc()

    // Only state no writer on this replica made (`replay: true`: a merge, a
    // reset) needs reconciling. Local commits (`replay: false`) index
    // themselves inline.
    this.#unsubscribe = subscribe(this.#doc, cs => {
      if (cs.replay !== true) return
      for (const op of cs.changes) {
        const dirty = dirtyFrom(op.path?.segments ?? [], op.change)
        switch (dirty.kind) {
          case "none":
            break
          case "all":
            this.#dirtyEntriesAll = true
            this.#dirtyUsage = true
            this.#dirtyValuesAll = true
            this.#dirtyListsAll = true
            break
          case "entries":
            if (dirty.keys === "all") this.#dirtyEntriesAll = true
            else for (const k of dirty.keys) this.#dirtyEntryKeys.add(k)
            break
          case "usage":
            this.#dirtyUsage = true
            break
          case "values":
            if (dirty.keys === "all") this.#dirtyValuesAll = true
            else for (const k of dirty.keys) this.#dirtyValueKeys.add(k)
            break
          case "lists":
            if (dirty.keys === "all") this.#dirtyListsAll = true
            else for (const k of dirty.keys) this.#dirtyListKeys.add(k)
            break
        }
      }
    })

    // A doc supplied by the caller may already hold state (rehydration).
    this.#dirtyEntriesAll = true
    this.#dirtyUsage = true
    this.#dirtyValuesAll = true
    this.#dirtyListsAll = true
  }

  get doc(): SessionDocHandle {
    return this.#doc
  }

  /** Test seam: the local index, for assertions. Reconciles first, so it
   *  reports exactly what the next read would see. */
  get index(): {
    lastSeq: number
    entrySeq: Map<string, number>
    entryOrder: string[]
    allSeqs: number[]
  } {
    if (this.#state === "open") this.#reconcile()
    const allSeqs = [
      ...this.#entrySeq.values(),
      ...this.#usageSeq.values(),
      ...[...this.#valueSeq.values()].map(v => v.seq),
      ...[...this.#listSeq.values()].flatMap(m => [...m.values()]),
    ]
    return {
      lastSeq: this.#seq,
      entrySeq: new Map(this.#entrySeq),
      entryOrder: [...this.#entryOrder],
      allSeqs,
    }
  }

  // ---- reconciliation: give newly OBSERVED items the next local seqs -----
  #nextSeq(): number {
    this.#seq += 1
    return this.#seq
  }

  #reconcile(): void {
    if (
      !this.#dirtyEntriesAll &&
      this.#dirtyEntryKeys.size === 0 &&
      !this.#dirtyUsage &&
      !this.#dirtyValuesAll &&
      !this.#dirtyListsAll &&
      this.#dirtyValueKeys.size === 0 &&
      this.#dirtyListKeys.size === 0
    ) {
      return
    }

    // --- entries: topological (parents first), uuidv7 order as tiebreak ---
    // Candidate ids come from the CHANGEFEED, so the cost is O(delta), not
    // O(document). The full scan only runs on rehydration.
    for (let attempt = 0; attempt < 2; attempt++) {
      let entryCandidates: string[] | undefined
      if (this.#dirtyEntriesAll) {
        this.#dirtyEntriesAll = false
        this.#dirtyEntryKeys.clear()
        entryCandidates = Object.keys(this.#doc.entries())
      } else if (this.#dirtyEntryKeys.size > 0) {
        entryCandidates = [...this.#dirtyEntryKeys]
        this.#dirtyEntryKeys = new Set()
      }
      if (entryCandidates !== undefined) {
        const fresh = entryCandidates.filter(id => !this.#entrySeq.has(id))
        if (fresh.length > 0) {
          const rec = new Map<string, StoredEntryRow | undefined>()
          for (const id of fresh) rec.set(id, this.#readEntryRaw(id))

          // The ordering itself is a pure calculation in @pineta/core, where
          // it is property-tested for permutation invariance. This shell only
          // assigns the seqs it hands back.
          const { ordered, unresolved } = orderNewEntries(
            fresh,
            id => rec.get(id)?.parentId,
          )
          for (const id of ordered) {
            this.#entrySeq.set(id, this.#nextSeq())
            this.#entryOrder.push(id)
            if (rec.get(id)?.type === "message") this.#messageCount += 1
          }

          if (unresolved.length > 0) {
            // A parent edge in neither the document nor this delta. Causal
            // delivery should make this impossible; fall back to a full scan
            // IN THIS SAME PASS rather than silently dropping entries.
            if (attempt === 1) {
              throw new Error(
                `Unresolvable entry parents during reconcile: ${unresolved.join(",")}`,
              )
            }
            this.#dirtyEntriesAll = true
            continue
          }
        }
      }
      break
    }

    // --- usage rows ---
    if (this.#dirtyUsage) {
      this.#dirtyUsage = false
      const all = this.#doc.usageRows() as Record<string, StoredUsageRow>
      const fresh = Object.keys(all).filter(id => !this.#usageSeq.has(id))
      fresh.sort()
      for (const id of fresh) {
        const row = all[id]
        if (row === undefined) continue
        this.#usageSeq.set(id, this.#nextSeq())
        this.#usageOrder.push(id)
        this.#usageTotal = addUsage(this.#usageTotal, row.usage)
      }
    }

    // --- values: a changed `wid` means a newer write won the LWW race ---
    let valueKeys: Set<string> | undefined
    if (this.#dirtyValuesAll) {
      this.#dirtyValuesAll = false
      this.#dirtyValueKeys.clear()
      valueKeys = new Set([
        ...Object.keys(this.#doc.values()),
        ...this.#valueSeq.keys(),
      ])
    } else if (this.#dirtyValueKeys.size > 0) {
      valueKeys = this.#dirtyValueKeys
      this.#dirtyValueKeys = new Set()
    }
    if (valueKeys !== undefined) {
      const sorted = [...valueKeys].sort()
      for (const pkey of sorted) {
        const stored = this.#readValueRaw(pkey)
        if (stored === undefined) {
          this.#valueSeq.delete(pkey)
          continue
        }
        const known = this.#valueSeq.get(pkey)
        if (known === undefined || known.wid !== stored.wid) {
          this.#valueSeq.set(pkey, { wid: stored.wid, seq: this.#nextSeq() })
        }
      }
    }

    // --- list elements ---
    let listKeys: Set<string> | undefined
    if (this.#dirtyListsAll) {
      this.#dirtyListsAll = false
      this.#dirtyListKeys.clear()
      listKeys = new Set([
        ...Object.keys(this.#doc.lists()),
        ...this.#listSeq.keys(),
      ])
    } else if (this.#dirtyListKeys.size > 0) {
      listKeys = this.#dirtyListKeys
      this.#dirtyListKeys = new Set()
    }
    if (listKeys !== undefined) {
      const sorted = [...listKeys].sort()
      for (const pkey of sorted) {
        const ref = this.#doc.lists.at(pkey)
        if (ref === undefined) {
          this.#listSeq.delete(pkey)
          continue
        }
        let known = this.#listSeq.get(pkey)
        if (known === undefined) {
          known = new Map()
          this.#listSeq.set(pkey, known)
        }
        for (const el of ref() as readonly StoredListElement[]) {
          if (!known.has(el.eid)) known.set(el.eid, this.#nextSeq())
        }
      }
    }
  }

  #assertOpen(): void {
    if (this.#state !== "open") throw new Error("KynetaStorage is closed")
  }

  #read(): void {
    this.#assertOpen()
    this.#reconcile()
  }

  /**
   * `entries` is a TYPED row now (ADR-0015), so this reader hands the row back
   * as-is and `fromStoredRow` rebuilds pi's entry from it. `values` is still
   * `Schema.any()`, so `#readValueRaw` below is the remaining place where an
   * untyped record has to be re-typed.
   */
  #readEntryRaw(id: string): StoredEntryRow | undefined {
    return this.#doc.entries.get(id) ?? undefined
  }

  #readValueRaw(pkey: string): StoredValueRecord | undefined {
    return this.#doc.values.get(pkey) as StoredValueRecord | undefined
  }

  /** A stored record's value as pi wrote it: a sealed checkpoint rejoined. */
  #valueOf(raw: StoredValueRecord, pkey: string): unknown {
    return raw.sealed === true
      ? unsealCheckpoint(raw.value, this.#doc.checkpointText.at(pkey)?.() ?? "")
      : raw.value
  }

  #entry(id: string): Entry | undefined {
    const raw = this.#readEntryRaw(id)
    if (raw === undefined) return undefined
    const seq = this.#entrySeq.get(id)
    if (seq === undefined) return undefined
    return fromStoredRow(raw, seq)
  }

  #storedValue<T>(namespace: string, key: string): StoredValue<T> | undefined {
    const pkey = physicalKey(namespace, key)
    const raw = this.#readValueRaw(pkey)
    if (raw === undefined) return undefined
    const seq = this.#valueSeq.get(pkey)?.seq
    if (seq === undefined) return undefined
    return {
      address: value<T>(raw.namespace, raw.key),
      value: this.#valueOf(raw, pkey) as T,
      seq,
    }
  }

  // --- commit -------------------------------------------------------------
  async commit(writes: Write[], _context: Context): Promise<CommitResult> {
    this.#assertOpen()
    const result = this.#commitQueue.then(() => this.#applyCommit(writes))
    this.#commitQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #applyCommit(writes: Write[]): CommitResult {
    this.#reconcile() // never allocate a seq below an already-observed one
    const firstSeq = this.#seq + 1
    const prepared = prepareStorageCommit(writes, firstSeq, this.#now())

    validateCommittedWrites(prepared.writes, firstSeq, {
      hasEntryOrUsageId: id =>
        this.#doc.entries.has(id) || this.#doc.usageRows.has(id),
      hasEntryId: id => this.#doc.entries.has(id),
    })

    // Stage index mutations; apply only after the substrate batch succeeds.
    const stagedEntries: Array<[string, number]> = []
    const stagedUsage: Array<[string, number]> = []
    const stagedValues: Array<[string, { wid: string; seq: number } | null]> =
      []
    const stagedLists: Array<[string, { eid: string; seq: number } | null]> = []
    let messageDelta = 0
    let usageTotal = this.#usageTotal

    batch(this.#doc, d => {
      for (const write of prepared.writes) {
        switch (write.kind) {
          case "entry": {
            const { kind: _k, seq: _s, ...entry } = write
            d.entries.set(entry.id, toStoredRow(entry))
            stagedEntries.push([entry.id, write.seq])
            if (entry.type === "message") messageDelta += 1
            break
          }
          case "usage": {
            const { kind: _k, seq: _s, ...row } = write
            d.usageRows.set(row.id, row)
            stagedUsage.push([row.id, write.seq])
            usageTotal = addUsage(usageTotal, row.usage)
            break
          }
          case "value": {
            const pkey = physicalKey(write.namespace, write.key)
            if (write.op === "delete") {
              d.values.delete(pkey)
              if (d.checkpointText.has(pkey)) d.checkpointText.delete(pkey)
              stagedValues.push([pkey, null])
            } else {
              const wid = makeToken(this.#peer)
              // A checkpoint's text is written as edits to its own text, so
              // each write stores what changed, not the whole view again.
              const sealed =
                write.namespace === CHECKPOINT_NAMESPACE
                  ? sealCheckpoint(write.value)
                  : undefined
              d.values.set(pkey, {
                namespace: write.namespace,
                key: write.key,
                value: sealed === undefined ? write.value : sealed.shell,
                wid,
                ...(sealed === undefined ? {} : { sealed: true }),
              })
              if (sealed !== undefined) {
                if (!d.checkpointText.has(pkey)) d.checkpointText.set(pkey, "")
                const text = d.checkpointText.at(pkey)
                if (text !== undefined)
                  applyTextEdits(text, tailEdit(text(), sealed.text))
              } else if (d.checkpointText.has(pkey))
                d.checkpointText.delete(pkey)
              stagedValues.push([pkey, { wid, seq: write.seq }])
            }
            break
          }
          case "list": {
            const pkey = physicalKey(write.namespace, write.key)
            if (write.op === "delete") {
              d.lists.delete(pkey)
              stagedLists.push([pkey, null])
            } else {
              if (!d.lists.has(pkey)) d.lists.set(pkey, [])
              const eid = makeToken(this.#peer)
              const listRef = d.lists.at(pkey)
              if (listRef === undefined) {
                throw new Error(`list vanished mid-commit: ${pkey}`)
              }
              listRef.push({ eid, value: write.value })
              stagedLists.push([pkey, { eid, seq: write.seq }])
            }
            break
          }
        }
      }
    })

    for (const [id, seq] of stagedEntries) {
      this.#entrySeq.set(id, seq)
      this.#entryOrder.push(id)
    }
    for (const [id, seq] of stagedUsage) {
      this.#usageSeq.set(id, seq)
      this.#usageOrder.push(id)
    }
    for (const [pkey, v] of stagedValues) {
      if (v === null) this.#valueSeq.delete(pkey)
      else this.#valueSeq.set(pkey, v)
    }
    for (const [pkey, v] of stagedLists) {
      if (v === null) this.#listSeq.delete(pkey)
      else {
        let bucket = this.#listSeq.get(pkey)
        if (bucket === undefined) {
          bucket = new Map<string, number>()
          this.#listSeq.set(pkey, bucket)
        }
        bucket.set(v.eid, v.seq)
      }
    }
    this.#messageCount += messageDelta
    this.#usageTotal = usageTotal
    this.#seq = Math.max(this.#seq, prepared.writes.at(-1)?.seq ?? this.#seq)

    // Our own writes echo through the changefeed without `replay`, so nothing
    // was marked dirty; but be explicit rather than rely on that.
    this.#dirtyUsage = false

    return { ...prepared.result, stats: this.#stats() }
  }

  #stats(): SessionStats {
    return { messageCount: this.#messageCount, usage: this.#usageTotal }
  }

  // --- queries ------------------------------------------------------------
  async getEntries(
    ids: string[],
    _context: Context,
  ): Promise<Map<string, Entry>> {
    this.#read()
    const found = new Map<string, Entry>()
    for (const id of ids) {
      const entry = this.#entry(id)
      if (entry !== undefined) found.set(id, entry)
    }
    return found
  }

  async getValue<T>(
    address: Value<T>,
    _context: Context,
  ): Promise<StoredValue<T> | undefined> {
    this.#read()
    return this.#storedValue<T>(address.namespace, address.key)
  }

  async scanValues<T>(
    prefix: Value<T>,
    _context: Context,
  ): Promise<StoredValue<T>[]> {
    this.#read()
    const out: StoredValue<T>[] = []
    for (const [pkey, meta] of this.#valueSeq) {
      const raw = this.#readValueRaw(pkey)
      if (raw === undefined) continue
      if (raw.namespace !== prefix.namespace || !raw.key.startsWith(prefix.key))
        continue
      out.push({
        address: value<T>(raw.namespace, raw.key),
        value: this.#valueOf(raw, pkey) as T,
        seq: meta.seq,
      })
    }
    return out.sort((a, b) => compareKeys(a.address.key, b.address.key))
  }

  async readList<T>(
    address: ValueList<T>,
    options: ListReadOptions | undefined,
    _context: Context,
  ): Promise<ListElement<T>[]> {
    this.#read()
    const resolved = resolveListReadOptions(options)
    const pkey = physicalKey(address.namespace, address.key)
    const ref = this.#doc.lists.at(pkey)
    if (ref === undefined) return []
    const seqs = this.#listSeq.get(pkey) ?? new Map<string, number>()
    const elements = (ref() as readonly StoredListElement[])
      .map(e => ({ seq: seqs.get(e.eid), value: e.value as T }))
      .filter((e): e is ListElement<T> => e.seq !== undefined)
      .sort((a, b) => a.seq - b.seq)
    const cursor = resolved.cursor
    const filtered = elements.filter(e =>
      cursor === undefined
        ? true
        : resolved.order === "asc"
          ? e.seq > cursor.seq
          : e.seq < cursor.seq,
    )
    const ordered =
      resolved.order === "asc" ? filtered : [...filtered].reverse()
    return ordered.slice(0, resolved.limit)
  }

  async scanBranch(
    query: StorageBranchScan,
    _context: Context,
  ): Promise<Entry[]> {
    this.#read()
    const start = this.#entry(query.start)
    if (start === undefined)
      throw new Error(`Unknown branch start: ${query.start}`)

    const path: Entry[] = []
    let entry: Entry | undefined = start
    while (entry !== undefined) {
      path.push(entry)
      if (entry.parentId === null) break
      entry = this.#entry(entry.parentId)
      if (entry === undefined) throw new Error("Corrupt branch: missing parent")
    }
    if (query.order === "oldestFirst") path.reverse()

    const stopped: Entry[] = []
    for (const candidate of path) {
      stopped.push(candidate)
      if (
        candidate.id === query.stopAtId ||
        candidate.type === query.stopAtType
      )
        break
    }

    const filtered = stopped
      .filter(c => query.type === undefined || c.type === query.type)
      .filter(
        c =>
          query.customType === undefined || c.customType === query.customType,
      )
      .filter(c => {
        const cursor = query.cursor
        if (cursor === undefined) return true
        return query.order === "oldestFirst"
          ? c.seq > cursor.seq
          : c.seq < cursor.seq
      })
    return query.limit === undefined
      ? filtered
      : filtered.slice(0, Math.max(0, query.limit))
  }

  async scanBranchStructure(
    query: StorageBranchScan,
    context: Context,
  ): Promise<EntryStructure[]> {
    return (await this.scanBranch(query, context)).map(entry => ({
      id: entry.id,
      parentId: entry.parentId,
      seq: entry.seq,
      timestamp: entry.timestamp,
      type: entry.type,
      ...(entry.customType === undefined
        ? {}
        : { customType: entry.customType }),
    }))
  }

  async scanEntries(query: EntryScan, _context: Context): Promise<Entry[]> {
    this.#read()
    const limit =
      query.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.trunc(query.limit))
    const order = this.#entryOrder // ascending seq by construction
    const out: Entry[] = []
    const descending = query.order === "desc"
    let index = descending ? order.length - 1 : 0
    while (index >= 0 && index < order.length && out.length < limit) {
      const id = order[index]
      index += descending ? -1 : 1
      if (id === undefined) continue
      const seq = this.#entrySeq.get(id)
      if (seq === undefined) continue
      if (query.fromSeq !== undefined && seq < query.fromSeq) continue
      if (query.toSeq !== undefined && seq > query.toSeq) continue
      const raw = this.#readEntryRaw(id)
      if (raw === undefined) continue
      if (query.type !== undefined && raw.type !== query.type) continue
      // `customType` lives in the payload: it is pi's variant data, not one of
      // the columns Pineta reasons about.
      if (
        query.customType !== undefined &&
        (raw.payload as { customType?: string }).customType !== query.customType
      )
        continue
      out.push(fromStoredRow(raw, seq))
    }
    return out
  }

  async scanUsage(query: UsageScan, _context: Context): Promise<UsageRow[]> {
    this.#read()
    const rows: UsageRow[] = []
    for (const id of this.#usageOrder) {
      const seq = this.#usageSeq.get(id)
      if (seq === undefined) continue
      if (query.fromSeq !== undefined && seq < query.fromSeq) continue
      if (query.toSeq !== undefined && seq > query.toSeq) continue
      const raw = this.#doc.usageRows.get(id) as StoredUsageRow | undefined
      if (raw === undefined) continue
      rows.push({ ...raw, seq })
    }
    if (query.order === "desc") rows.reverse()
    return query.limit === undefined
      ? rows
      : rows.slice(0, Math.max(0, query.limit))
  }

  async getStats(_context: Context): Promise<SessionStats> {
    this.#read()
    return this.#stats()
  }

  close(_context: Context): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#state = "closing"
    this.#closePromise = this.#commitQueue.then(() => {
      this.#state = "closed"
      this.#unsubscribe?.()
    })
    return this.#closePromise
  }
}
