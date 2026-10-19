// pi/storage — our implementation of pi's `Storage` port, over a root's Kyneta
// doc and, for pi's operation-scoped pending state, the root's scratch doc.
//
// `seq` is a replica-local arrival index, never stored (`arrivals.ts`). Two
// paths index the documents: a local commit indexes its own
// writes with pi's seqs, and a replayed change (hydration, or a merge from
// another replica) marks keys dirty, which the next read indexes. Both end in
// `ArrivalIndex.apply`.

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
import { batch, createDoc, subscribe } from "@kyneta/schema"
import {
  type BlobStore,
  type ImageRef,
  isImageMime,
  isImageRef,
  type ThreadId,
  tailEdit,
} from "@pinetrie/core"
import {
  applyTextEdits,
  type PendingFieldsHandle,
  physicalKey,
  RootDoc,
  type RootDocHandle,
  type ScratchDocHandle,
  type StoredValueRecord,
  valuePrefix,
} from "@pinetrie/schema"
import { ArrivalIndex, type Observed, planArrivals } from "./arrivals.ts"
import {
  type CommitPart,
  type CommittedWrite,
  committedImages,
  type DocOp,
  type PendingOp,
  planCommit,
  type StoredUsageRow,
  splitCommit,
} from "./commit.ts"
import {
  CLEAN,
  dirtyScope,
  EVERYTHING,
  isClean,
  join,
  type Scope,
} from "./dirty.ts"
import { blobSha256 } from "./images.ts"
import {
  boundsAfter,
  compareKeys,
  entryStructure,
  type Located,
  piLimit,
  rowMatches,
  selectBranch,
  walkBranch,
} from "./queries.ts"
import type { BlobOf, RefOf } from "./stored-images.ts"
import { fromStoredRow } from "./stored-row.ts"
import {
  decodeValue,
  isScratchKey,
  type StoredListElement,
} from "./stored-values.ts"
import { threadOfContext } from "./thread-context.ts"

let tokenCounter = 0
const makeToken = (peer: string): string =>
  `${peer}-${(tokenCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Store one planned operation in a root's document: an entry or a usage row
 * there, any other in `writePendingOp`. Only `KynetaStorage`'s commit calls
 * it, for the root's part.
 */
function writeOp(d: RootDocHandle, op: DocOp): void {
  switch (op.kind) {
    case "entry":
      d.entries.set(op.row.id, op.row)
      return
    case "usage":
      d.usageRows.set(op.row.id, op.row)
      return
    default:
      writePendingOp(d, op)
  }
}

/**
 * Store a value, a list's element or a delete in `d`: a root's document, or
 * its scratch document for a scratch key (`isScratchKey`).
 */
function writePendingOp(d: PendingFieldsHandle, op: PendingOp): void {
  switch (op.kind) {
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

/** Where `KynetaStorage` finds a root's scratch document. */
export interface ScratchSource {
  held(): ScratchDocHandle | undefined
  make(): Promise<ScratchDocHandle>
}

interface KynetaStorageOptions {
  readonly doc?: RootDocHandle
  /**
   * The root's scratch document, which holds the keys `isScratchKey` names:
   * `held`, the one loaded now, for a read; `make`, that one or a new one
   * once it can be written, for a write (making one stores it, so a read
   * never does). Asked at each use, never kept across one: the host
   * destroys it between runs. Without it, every key is in `doc`.
   */
  readonly scratch?: ScratchSource
  /**
   * Resolves once the store holds every write made so far: waited for
   * between a commit's parts in different documents. Without it, nothing
   * is waited for.
   */
  readonly stored?: () => Promise<void>
  readonly peerId?: string
  readonly now?: () => number
  /**
   * Where a message's images are kept. Without it, every image
   * part is stored inline, as pi wrote it.
   */
  readonly blobs?: Pick<BlobStore, "get" | "ref">
  /**
   * The thread of an entry whose commit's context names none.
   * Only pi's storage conformance suite gives one: its commits are made
   * outside any thread. Without it, such a commit throws (`threadOfEntries`).
   */
  readonly fallbackThread?: ThreadId
}

/**
 * `implements Storage` makes pi's interface check all eleven methods at
 * compile time, so a signature drift on a pi upgrade fails before the
 * conformance suite runs.
 */
export class KynetaStorage implements Storage {
  readonly #doc: RootDocHandle
  readonly #scratch: ScratchSource | undefined
  readonly #storedNow: () => Promise<void>
  /** The scratch document last handed over, and its subscription's end. */
  #scratchHeld:
    | { readonly doc: ScratchDocHandle; readonly unsubscribe: () => void }
    | undefined
  readonly #blobs: Pick<BlobStore, "get" | "ref"> | undefined
  readonly #fallbackThread: ThreadId | undefined
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
    this.#doc = options.doc ?? createDoc(RootDoc)
    this.#scratch = options.scratch
    this.#storedNow = options.stored ?? (async () => {})
    this.#blobs = options.blobs
    this.#fallbackThread = options.fallbackThread

    this.#unsubscribe = subscribe(this.#doc, this.#replayed)
  }

  /**
   * Only state no writer on this replica made (`replay: true`: a merge, a
   * reset, a hydration) needs reconciling. Local commits index themselves.
   */
  #replayed = (cs: {
    readonly replay?: boolean
    readonly changes: Parameters<typeof dirtyScope>[0]
  }): void => {
    if (cs.replay !== true) return
    this.#scope = join(this.#scope, dirtyScope(cs.changes))
  }

  // ---- the two documents: which holds a key -------------------------------

  /**
   * The scratch document, as `scratch` hands it over now, followed: one not
   * seen before (the first, or a fresh one after a destroy) is subscribed to
   * as the root is, and its values and lists are read again, since it may
   * hold what a crash left. The one it replaces was empty when destroyed, so
   * the index holds none of its keys.
   */
  #scratchDoc(): ScratchDocHandle | undefined {
    const doc = this.#scratch?.held()
    return doc === undefined ? undefined : this.#follow(doc)
  }

  /** The scratch document to write, made if there is none, followed as `#scratchDoc` follows it. */
  async #scratchToWrite(): Promise<ScratchDocHandle | undefined> {
    const doc = await this.#scratch?.make()
    return doc === undefined ? undefined : this.#follow(doc)
  }

  /** `doc`, subscribed to if it is not the one followed already. */
  #follow(doc: ScratchDocHandle): ScratchDocHandle {
    if (doc === this.#scratchHeld?.doc) return doc
    this.#scratchHeld?.unsubscribe()
    this.#scratchHeld = {
      doc,
      unsubscribe: subscribe(doc, this.#replayed),
    }
    this.#scope = join(this.#scope, { ...CLEAN, values: "all", lists: "all" })
    return doc
  }

  /**
   * The document that holds `pkey`: the scratch document for a scratch key,
   * else the root. The only way a pending key reaches a document. Undefined
   * for a scratch key with no scratch document now, which holds nothing.
   */
  #pendingDocument(pkey: string): PendingFieldsHandle | undefined {
    return this.#scratch !== undefined && isScratchKey(pkey)
      ? this.#scratchDoc()
      : this.#doc
  }

  /** Whether a pending operation is written to the scratch document. */
  #inScratch = (op: PendingOp): boolean =>
    this.#scratch !== undefined && isScratchKey(op.pkey)

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

    const scratch = this.#scratchDoc()
    const values = new Map<string, { wid: string | undefined } | undefined>()
    for (const pkey of keysOf(scope.values, () => [
      ...Object.keys(doc.values()),
      ...Object.keys(scratch?.values() ?? {}),
      ...index.valueKeys(),
    ])) {
      const record = this.#record(pkey)
      values.set(pkey, record === undefined ? undefined : { wid: record.wid })
    }

    const lists = new Map<string, readonly string[] | undefined>()
    for (const pkey of keysOf(scope.lists, () => [
      ...Object.keys(doc.lists()),
      ...Object.keys(scratch?.lists() ?? {}),
      ...index.listKeys(),
    ])) {
      const list = this.#pendingDocument(pkey)?.lists.at(pkey)
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
    return this.#pendingDocument(pkey)?.values.get(pkey) as
      | StoredValueRecord
      | undefined
  }

  /** A blob's bytes, for the rejoin: none without a store. */
  #blobOf: BlobOf = sha => {
    const blob = this.#blobs?.get(sha)
    // A session holds images alone: a quote's markdown is never one.
    return blob === undefined || !isImageMime(blob.mimeType)
      ? undefined
      : { bytes: blob.bytes, mimeType: blob.mimeType }
  }

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
        () => this.#pendingDocument(pkey)?.checkpointText.at(pkey)?.() ?? "",
        this.#blobOf,
      ) as T,
      seq,
    }
  }

  /**
   * The stored image of each inline image in `writes`, by its base64. `read`
   * stores its images before pi writes them, so each is found by the
   * hash of its bytes.
   */
  #refOf(writes: readonly CommittedWrite[]): RefOf {
    const blobs = this.#blobs
    const refs = new Map<string, ImageRef>()
    if (blobs !== undefined)
      for (const data of writes.flatMap(committedImages)) {
        if (refs.has(data)) continue
        const ref = blobs.ref(blobSha256(Buffer.from(data, "base64")))
        if (ref !== undefined && isImageRef(ref)) refs.set(data, ref)
      }
    return data => refs.get(data)
  }

  // --- commit -------------------------------------------------------------
  async commit(writes: Write[], context: Context): Promise<CommitResult> {
    this.#assertOpen()
    const named = threadOfContext(context)
    const result = this.#commitQueue.then(() =>
      this.#applyCommit(writes, named),
    )
    this.#commitQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #applyCommit(
    writes: Write[],
    named: ThreadId | undefined,
  ): Promise<CommitResult> {
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
      named,
      fallback: this.#fallbackThread,
    })
    let last: CommitPart["target"] | null = null
    for (const part of splitCommit(plan.ops, this.#inScratch)) {
      if (last !== null && part.target !== last) await this.#storedNow()
      await this.#writePart(part)
      last = part.target
    }
    // After the parts, so a write that throws leaves the index as it was.
    this.#index.apply(plan.batch)
    return { ...prepared.result, stats: this.#index.stats() }
  }

  /** One part of a commit, in one batch of its document. */
  async #writePart(part: CommitPart): Promise<void> {
    if (part.target === "root") {
      batch(this.#doc, d => {
        for (const op of part.ops) writeOp(d, op)
      })
      return
    }
    const scratch = await this.#scratchToWrite()
    if (scratch === undefined)
      throw new Error("the root's scratch document could not be made")
    batch(scratch, d => {
      for (const op of part.ops) writePendingOp(d, op)
    })
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
    const stored = this.#pendingDocument(pkey)?.lists.at(pkey)
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
    return this.#branch(query).map(entryStructure)
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
      .take(piLimit(query.limit))
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
      .take(piLimit(query.limit))
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
      this.#scratchHeld?.unsubscribe()
      this.#scratchHeld = undefined
    })
    return this.#closePromise
  }
}
