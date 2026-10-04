// pi/storage — our implementation of pi's `Storage` port, over a Kyneta doc.
//
// `seq` is a replica-local arrival index, never stored (ADR-0013;
// `arrivals.ts`). Two paths index the document: a local commit indexes its own
// writes with pi's seqs, and a replayed change (hydration, or a merge from
// another replica) marks keys dirty, which the next read indexes. Both end in
// `ArrivalIndex.apply`.
//
// This file is the shell: it reads the document, calls the pure planners
// (`dirty.ts`, `arrivals.ts`, `commit.ts`, `queries.ts`), writes their plans,
// and keeps the commit queue and close state.

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
import { batch, subscribe } from "@kyneta/schema"
import { type BlobStore, type ImageRef, tailEdit } from "@pineta/core"
import {
  applyTextEdits,
  newStorageDoc,
  physicalKey,
  type StorageDocHandle,
  type StoredValueRecord,
  valuePrefix,
} from "@pineta/schema"
import { ArrivalIndex, type Observed, planArrivals } from "./arrivals.ts"
import {
  type CommittedWrite,
  type DocOp,
  imagesOf,
  planCommit,
  type StoredUsageRow,
} from "./commit.ts"
import {
  CLEAN,
  EVERYTHING,
  isClean,
  join,
  type Scope,
  scopeOf,
} from "./dirty.ts"
import { sha256Of } from "./images.ts"
import {
  boundsAfter,
  compareKeys,
  type Located,
  limitOf,
  rowMatches,
  selectBranch,
  structureOf,
  walkBranch,
} from "./queries.ts"
import type { BlobOf, RefOf } from "./stored-images.ts"
import { fromStoredRow } from "./stored-row.ts"
import { decodeValue, type StoredListElement } from "./stored-values.ts"

let tokenCounter = 0
const makeToken = (peer: string): string =>
  `${peer}-${(tokenCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Store one planned operation. The only code that writes the document on commit. */
function writeOp(d: StorageDocHandle, op: DocOp): void {
  switch (op.kind) {
    case "entry":
      d.entries.set(op.row.id, op.row)
      return
    case "usage":
      d.usageRows.set(op.row.id, op.row)
      return
    case "value": {
      d.values.set(op.pkey, op.record)
      if (op.text === undefined) {
        if (d.checkpointText.has(op.pkey)) d.checkpointText.delete(op.pkey)
        return
      }
      // A checkpoint's text is written as edits to its own text, so each
      // write stores what changed, not the whole view again.
      if (!d.checkpointText.has(op.pkey)) d.checkpointText.set(op.pkey, "")
      const text = d.checkpointText.at(op.pkey)
      if (text !== undefined) applyTextEdits(text, tailEdit(text(), op.text))
      return
    }
    case "element": {
      if (!d.lists.has(op.pkey)) d.lists.set(op.pkey, [])
      const list = d.lists.at(op.pkey)
      if (list === undefined)
        throw new Error(`list vanished mid-commit: ${op.pkey}`)
      list.push(op.element)
      return
    }
    case "delete":
      if (op.field === "lists") {
        d.lists.delete(op.pkey)
        return
      }
      d.values.delete(op.pkey)
      if (d.checkpointText.has(op.pkey)) d.checkpointText.delete(op.pkey)
      return
  }
}

export interface KynetaStorageOptions {
  readonly doc?: StorageDocHandle
  readonly peerId?: string
  readonly now?: () => number
  /**
   * Where a message's images are kept (ADR-0051). Without it, every image
   * part is stored inline, as pi wrote it.
   */
  readonly blobs?: Pick<BlobStore, "get" | "ref">
}

/**
 * `implements Storage` makes pi's interface check all eleven methods at
 * compile time, so a signature drift on a pi upgrade fails before the
 * conformance suite runs.
 */
export class KynetaStorage implements Storage {
  readonly #doc: StorageDocHandle
  readonly #blobs: Pick<BlobStore, "get" | "ref"> | undefined
  readonly #now: () => number
  readonly #peer: string
  readonly #index = new ArrivalIndex()
  readonly #unsubscribe: () => void
  /** A caller's doc may already hold state, so everything starts dirty. */
  #scope: Scope = EVERYTHING
  #commitQueue: Promise<unknown> = Promise.resolve()
  #state: "open" | "closing" | "closed" = "open"
  #closePromise: Promise<void> | undefined

  constructor(options: KynetaStorageOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#peer = options.peerId ?? "p"
    this.#doc = options.doc ?? newStorageDoc()
    this.#blobs = options.blobs

    // Only state no writer on this replica made (`replay: true`: a merge, a
    // reset) needs reconciling. Local commits index themselves.
    this.#unsubscribe = subscribe(this.#doc, cs => {
      if (cs.replay !== true) return
      this.#scope = join(this.#scope, scopeOf(cs.changes))
    })
  }

  // ---- reconciliation: give newly observed items the next local seqs -----

  #reconcile(): void {
    if (isClean(this.#scope)) return
    const observed = this.#observe(this.#scope)
    const { batch: arrived, cycle } = planArrivals(observed, this.#index)
    this.#index.apply(arrived)
    this.#scope = CLEAN
    if (cycle.length > 0)
      throw new Error(`Entries on a parent cycle: ${cycle.join(",")}`)
  }

  /**
   * The document, read for the scope's keys. For a whole field of values or
   * lists, the keys the index holds are read too, so a deletion is seen.
   */
  #observe(scope: Scope): Observed {
    const doc = this.#doc
    const index = this.#index
    const keysOf = (
      keys: ReadonlySet<string> | "all",
      all: () => Iterable<string>,
    ): Iterable<string> => (keys === "all" ? new Set(all()) : keys)

    const entries = new Map<string, { parentId: string | null; type: string }>()
    for (const id of keysOf(scope.entries, () => Object.keys(doc.entries()))) {
      const row = doc.entries.get(id)
      if (row !== undefined && row !== null)
        entries.set(id, { parentId: row.parentId, type: row.type })
    }

    const usage = new Map<string, StoredUsageRow["usage"]>()
    for (const id of keysOf(scope.usageRows, () =>
      Object.keys(doc.usageRows()),
    )) {
      const row = doc.usageRows.get(id) as StoredUsageRow | undefined
      if (row !== undefined) usage.set(id, row.usage)
    }

    const values = new Map<string, { wid: string | undefined } | undefined>()
    for (const pkey of keysOf(scope.values, () => [
      ...Object.keys(doc.values()),
      ...index.valueKeys(),
    ])) {
      const record = this.#record(pkey)
      values.set(pkey, record === undefined ? undefined : { wid: record.wid })
    }

    const lists = new Map<string, readonly string[] | undefined>()
    for (const pkey of keysOf(scope.lists, () => [
      ...Object.keys(doc.lists()),
      ...index.listKeys(),
    ])) {
      const list = doc.lists.at(pkey)
      lists.set(
        pkey,
        list === undefined
          ? undefined
          : (list() as readonly StoredListElement[]).map(e => e.eid),
      )
    }

    return { entries, usage, values, lists }
  }

  #assertOpen(): void {
    if (this.#state !== "open") throw new Error("KynetaStorage is closed")
  }

  #read(): void {
    this.#assertOpen()
    this.#reconcile()
  }

  #record(pkey: string): StoredValueRecord | undefined {
    return this.#doc.values.get(pkey) as StoredValueRecord | undefined
  }

  /** A blob's bytes, for the rejoin: none without a store. */
  #blobOf: BlobOf = sha => this.#blobs?.get(sha)

  #located = (id: string): Located | undefined => {
    const row = this.#doc.entries.get(id)
    const seq = this.#index.entries.seqOf(id)
    return row === undefined || row === null || seq === undefined
      ? undefined
      : { row, seq }
  }

  #entry = ({ row, seq }: Located): Entry =>
    fromStoredRow(row, seq, this.#blobOf)

  /** The rows a branch scan returns. Only these are rebuilt into entries. */
  #branch(query: StorageBranchScan): Located[] {
    this.#read()
    return selectBranch(walkBranch(query.start, this.#located), query)
  }

  #stored<T>(pkey: string): StoredValue<T> | undefined {
    const record = this.#record(pkey)
    const seq = this.#index.valueAt(pkey)?.seq
    if (record === undefined || seq === undefined) return undefined
    return {
      address: value<T>(record.namespace, record.key),
      value: decodeValue(
        record,
        () => this.#doc.checkpointText.at(pkey)?.() ?? "",
        this.#blobOf,
      ) as T,
      seq,
    }
  }

  /**
   * The stored image of each inline image in `writes`, by its base64. `read`
   * stores its images before pi writes them (S93), so each is found by the
   * hash of its bytes.
   */
  #refOf(writes: readonly CommittedWrite[]): RefOf {
    const blobs = this.#blobs
    const refs = new Map<string, ImageRef>()
    if (blobs !== undefined)
      for (const data of writes.flatMap(imagesOf)) {
        if (refs.has(data)) continue
        const ref = blobs.ref(sha256Of(Buffer.from(data, "base64")))
        if (ref !== undefined) refs.set(data, ref)
      }
    return data => refs.get(data)
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
    const firstSeq = this.#index.lastSeq + 1
    const prepared = prepareStorageCommit(writes, firstSeq, this.#now())
    validateCommittedWrites(prepared.writes, firstSeq, {
      hasEntryOrUsageId: id =>
        this.#doc.entries.has(id) || this.#doc.usageRows.has(id),
      hasEntryId: id => this.#doc.entries.has(id),
    })
    const plan = planCommit(prepared.writes, {
      refOf: this.#refOf(prepared.writes),
      token: () => makeToken(this.#peer),
    })
    batch(this.#doc, d => {
      for (const op of plan.ops) writeOp(d, op)
    })
    // After the batch, so a write that throws leaves the index as it was.
    this.#index.apply(plan.batch)
    return { ...prepared.result, stats: this.#index.stats() }
  }

  // --- queries ------------------------------------------------------------
  async getEntries(
    ids: string[],
    _context: Context,
  ): Promise<Map<string, Entry>> {
    this.#read()
    const found = new Map<string, Entry>()
    for (const id of ids) {
      const located = this.#located(id)
      if (located !== undefined) found.set(id, this.#entry(located))
    }
    return found
  }

  async getValue<T>(
    address: Value<T>,
    _context: Context,
  ): Promise<StoredValue<T> | undefined> {
    this.#read()
    return this.#stored<T>(physicalKey(address.namespace, address.key))
  }

  async scanValues<T>(
    prefix: Value<T>,
    _context: Context,
  ): Promise<StoredValue<T>[]> {
    this.#read()
    const under = valuePrefix(prefix.namespace, prefix.key)
    return this.#index
      .valueKeys()
      .filter(pkey => pkey.startsWith(under))
      .map(pkey => this.#stored<T>(pkey))
      .filter(stored => stored !== undefined)
      .toArray()
      .sort((a, b) => compareKeys(a.address.key, b.address.key))
  }

  async readList<T>(
    address: ValueList<T>,
    options: ListReadOptions | undefined,
    _context: Context,
  ): Promise<ListElement<T>[]> {
    this.#read()
    const resolved = resolveListReadOptions(options)
    const pkey = physicalKey(address.namespace, address.key)
    const line = this.#index.list(pkey)
    const stored = this.#doc.lists.at(pkey)
    if (line === undefined || stored === undefined) return []
    const values = new Map(
      (stored() as readonly StoredListElement[]).map(e => [e.eid, e.value]),
    )
    return line
      .walk(
        resolved.order,
        boundsAfter(resolved.order === "asc", resolved.cursor),
      )
      .filter(([eid]) => values.has(eid))
      .map(([eid, seq]) => ({ seq, value: values.get(eid) as T }))
      .take(resolved.limit)
      .toArray()
  }

  async scanBranch(
    query: StorageBranchScan,
    _context: Context,
  ): Promise<Entry[]> {
    return this.#branch(query).map(this.#entry)
  }

  async scanBranchStructure(
    query: StorageBranchScan,
    _context: Context,
  ): Promise<EntryStructure[]> {
    return this.#branch(query).map(structureOf)
  }

  async scanEntries(query: EntryScan, _context: Context): Promise<Entry[]> {
    this.#read()
    return this.#index.entries
      .walk(query.order ?? "asc", { from: query.fromSeq, to: query.toSeq })
      .map(([id]) => this.#located(id))
      .filter(
        (located): located is Located =>
          located !== undefined && rowMatches(located.row, query),
      )
      .take(limitOf(query.limit))
      .map(located => this.#entry(located))
      .toArray()
  }

  async scanUsage(query: UsageScan, _context: Context): Promise<UsageRow[]> {
    this.#read()
    return this.#index.usage
      .walk(query.order ?? "asc", { from: query.fromSeq, to: query.toSeq })
      .map(([id, seq]) => {
        const row = this.#doc.usageRows.get(id) as StoredUsageRow | undefined
        return row === undefined ? undefined : { ...row, seq }
      })
      .filter(row => row !== undefined)
      .take(limitOf(query.limit))
      .toArray()
  }

  async getStats(_context: Context): Promise<SessionStats> {
    this.#read()
    return this.#index.stats()
  }

  close(_context: Context): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#state = "closing"
    this.#closePromise = this.#commitQueue.then(() => {
      this.#state = "closed"
      this.#unsubscribe()
    })
    return this.#closePromise
  }
}
