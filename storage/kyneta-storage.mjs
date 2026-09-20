// storage/kyneta-storage — pi's `Storage` port over a Kyneta/Loro document.
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

import { subscribe } from "@kyneta/schema"
import { batch } from "@kyneta/loro-schema"
import {
  prepareStorageCommit,
  resolveListReadOptions,
  validateCommittedWrites,
  value,
} from "@earendil-works/pi-agent-core"
import { newSessionDoc } from "../schema/index.mjs"
import { addUsage, emptyUsage } from "./pi-deep.mjs"

const physicalKey = (namespace, key) => `${namespace}\u0000${key}`

// pi orders value keys by Unicode CODE POINT, not UTF-16 code unit.
function compareKeys(left, right) {
  const l = Array.from(left, (c) => c.codePointAt(0))
  const r = Array.from(right, (c) => c.codePointAt(0))
  const n = Math.min(l.length, r.length)
  for (let i = 0; i < n; i++) {
    const d = l[i] - r[i]
    if (d !== 0) return d
  }
  return l.length - r.length
}

let tokenCounter = 0
const makeToken = (peer) => `${peer}-${(tokenCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export class KynetaStorage {
  #doc
  #now
  #peer
  #commitQueue = Promise.resolve()
  #state = "open"
  #closePromise
  #unsubscribe

  // ---- the derived local index (NOT replicated) --------------------------
  #seq = 0 // last assigned seq; next is #seq + 1
  #entrySeq = new Map() // id -> seq
  #entryOrder = [] // ids, ascending seq (append-only)
  #usageSeq = new Map() // id -> seq
  #usageOrder = []
  #valueSeq = new Map() // pkey -> { wid, seq }
  #listSeq = new Map() // pkey -> Map(eid -> seq)
  #messageCount = 0
  #usageTotal = emptyUsage()

  // dirty scopes collected from the changefeed
  #dirtyEntryKeys = new Set()
  #dirtyEntriesAll = false
  #dirtyUsage = false
  #dirtyValueKeys = new Set()
  #dirtyValuesAll = false
  #dirtyListKeys = new Set()
  #dirtyListsAll = false

  constructor(options = {}) {
    this.#now = options.now ?? Date.now
    this.#peer = options.peerId ?? "p"
    this.#doc = options.doc ?? newSessionDoc()

    // Only REMOTE state (`replay: true` — merge payloads / substrate bridges)
    // needs reconciling. Local commits index themselves inline.
    this.#unsubscribe = subscribe(this.#doc, (cs) => {
      if (cs.replay !== true) return
      for (const op of cs.changes) {
        const segs = op.path?.segments ?? []
        const field = segs[0]?.key
        if (field === "entries") {
          const ch = op.change
          if (ch?.type === "map" && ch.set) {
            for (const k of Object.keys(ch.set)) this.#dirtyEntryKeys.add(k)
          } else this.#dirtyEntriesAll = true
        } else if (field === "usageRows") this.#dirtyUsage = true
        else if (field === "values") {
          const ch = op.change
          if (ch?.type === "map" && (ch.set || ch.delete)) {
            for (const k of Object.keys(ch.set ?? {})) this.#dirtyValueKeys.add(k)
            for (const k of ch.delete ?? []) this.#dirtyValueKeys.add(k)
          } else this.#dirtyValuesAll = true
        } else if (field === "lists") {
          const listKey = segs[1]?.key
          if (listKey !== undefined) this.#dirtyListKeys.add(listKey)
          else {
            const ch = op.change
            if (ch?.type === "map" && (ch.set || ch.delete)) {
              for (const k of Object.keys(ch.set ?? {})) this.#dirtyListKeys.add(k)
              for (const k of ch.delete ?? []) this.#dirtyListKeys.add(k)
            } else this.#dirtyListsAll = true
          }
        } else if (field === "pendingText" || field === "activeRunId") {
          // Live-stream fields (ADR-0014). Not backed by pi's Storage port, so
          // a change there never invalidates the derived seq index.
        } else {
          this.#dirtyEntriesAll = true
          this.#dirtyUsage = true
          this.#dirtyValuesAll = true
          this.#dirtyListsAll = true
        }
      }
    })

    // A doc supplied by the caller may already hold state (rehydration).
    this.#dirtyEntriesAll = true
    this.#dirtyUsage = true
    this.#dirtyValuesAll = true
    this.#dirtyListsAll = true
  }

  get doc() {
    return this.#doc
  }

  /** Test seam: the local index, for assertions. Reconciles first, so it
   *  reports exactly what the next read would see. */
  get index() {
    if (this.#state === "open") this.#reconcile()
    const allSeqs = [
      ...this.#entrySeq.values(),
      ...this.#usageSeq.values(),
      ...[...this.#valueSeq.values()].map((v) => v.seq),
      ...[...this.#listSeq.values()].flatMap((m) => [...m.values()]),
    ]
    return {
      lastSeq: this.#seq,
      entrySeq: new Map(this.#entrySeq),
      entryOrder: [...this.#entryOrder],
      allSeqs,
    }
  }

  // ---- reconciliation: give newly OBSERVED items the next local seqs -----
  #nextSeq() {
    this.#seq += 1
    return this.#seq
  }

  #reconcile() {
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
    let entryCandidates
    if (this.#dirtyEntriesAll) {
      this.#dirtyEntriesAll = false
      this.#dirtyEntryKeys.clear()
      entryCandidates = Object.keys(this.#doc.entries())
    } else if (this.#dirtyEntryKeys.size > 0) {
      entryCandidates = [...this.#dirtyEntryKeys]
      this.#dirtyEntryKeys = new Set()
    }
    if (entryCandidates !== undefined) {
      const fresh = entryCandidates.filter((id) => !this.#entrySeq.has(id))
      if (fresh.length > 0) {
        const rec = new Map()
        for (const id of fresh) rec.set(id, this.#doc.entries.get(id))
        const pending = new Set(fresh)
        const children = new Map()
        const ready = []
        for (const id of fresh) {
          const p = rec.get(id)?.parentId
          if (p === null || p === undefined || !pending.has(p)) ready.push(id)
          else {
            if (!children.has(p)) children.set(p, [])
            children.get(p).push(id)
          }
        }
        // Kahn, popping the smallest available id each round for determinism.
        const queue = ready
        while (queue.length > 0) {
          queue.sort()
          const id = queue.shift()
          if (!pending.has(id)) continue
          pending.delete(id)
          const seq = this.#nextSeq()
          this.#entrySeq.set(id, seq)
          this.#entryOrder.push(id)
          if (rec.get(id)?.type === "message") this.#messageCount += 1
          for (const c of children.get(id) ?? []) queue.push(c)
        }
        if (pending.size > 0) {
          // A parent edge that is not in the document AND not in this delta.
          // Causal delivery should make this impossible; fall back to a full
          // scan IN THIS SAME PASS rather than silently dropping entries.
          if (attempt === 1) {
            throw new Error(`Unresolvable entry parents during reconcile: ${[...pending].join(",")}`)
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
      const all = this.#doc.usageRows()
      const fresh = Object.keys(all).filter((id) => !this.#usageSeq.has(id))
      fresh.sort()
      for (const id of fresh) {
        this.#usageSeq.set(id, this.#nextSeq())
        this.#usageOrder.push(id)
        this.#usageTotal = addUsage(this.#usageTotal, all[id].usage)
      }
    }

    // --- values: a changed `wid` means a newer write won the LWW race ---
    let valueKeys
    if (this.#dirtyValuesAll) {
      this.#dirtyValuesAll = false
      this.#dirtyValueKeys.clear()
      valueKeys = new Set([...Object.keys(this.#doc.values()), ...this.#valueSeq.keys()])
    } else if (this.#dirtyValueKeys.size > 0) {
      valueKeys = this.#dirtyValueKeys
      this.#dirtyValueKeys = new Set()
    }
    if (valueKeys !== undefined) {
      const sorted = [...valueKeys].sort()
      for (const pkey of sorted) {
        const stored = this.#doc.values.get(pkey)
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
    let listKeys
    if (this.#dirtyListsAll) {
      this.#dirtyListsAll = false
      this.#dirtyListKeys.clear()
      listKeys = new Set([...Object.keys(this.#doc.lists()), ...this.#listSeq.keys()])
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
        for (const el of ref()) {
          if (!known.has(el.eid)) known.set(el.eid, this.#nextSeq())
        }
      }
    }
  }

  #assertOpen() {
    if (this.#state !== "open") throw new Error("KynetaStorage is closed")
  }

  #read() {
    this.#assertOpen()
    this.#reconcile()
  }

  #entry(id) {
    const raw = this.#doc.entries.get(id)
    if (raw === undefined) return undefined
    const seq = this.#entrySeq.get(id)
    return { ...raw, seq }
  }

  #storedValue(namespace, key) {
    const pkey = physicalKey(namespace, key)
    const raw = this.#doc.values.get(pkey)
    if (raw === undefined) return undefined
    return { address: value(raw.namespace, raw.key), value: raw.value, seq: this.#valueSeq.get(pkey)?.seq }
  }

  // --- commit -------------------------------------------------------------
  async commit(writes, _context) {
    this.#assertOpen()
    const result = this.#commitQueue.then(() => this.#applyCommit(writes))
    this.#commitQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #applyCommit(writes) {
    this.#reconcile() // never allocate a seq below an already-observed one
    const firstSeq = this.#seq + 1
    const prepared = prepareStorageCommit(writes, firstSeq, this.#now())

    validateCommittedWrites(prepared.writes, firstSeq, {
      hasEntryOrUsageId: (id) => this.#doc.entries.has(id) || this.#doc.usageRows.has(id),
      hasEntryId: (id) => this.#doc.entries.has(id),
    })

    // Stage index mutations; apply only after the substrate batch succeeds.
    const stagedEntries = []
    const stagedUsage = []
    const stagedValues = []
    const stagedLists = []
    let messageDelta = 0
    let usageTotal = this.#usageTotal

    batch(this.#doc, (d) => {
      for (const write of prepared.writes) {
        switch (write.kind) {
          case "entry": {
            const { kind: _k, seq: _s, ...entry } = write
            d.entries.set(entry.id, entry)
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
              stagedValues.push([pkey, null])
            } else {
              const wid = makeToken(this.#peer)
              d.values.set(pkey, {
                namespace: write.namespace,
                key: write.key,
                value: write.value,
                wid,
              })
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
              d.lists.at(pkey).push({ eid, value: write.value })
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
        if (!this.#listSeq.has(pkey)) this.#listSeq.set(pkey, new Map())
        this.#listSeq.get(pkey).set(v.eid, v.seq)
      }
    }
    this.#messageCount += messageDelta
    this.#usageTotal = usageTotal
    this.#seq = Math.max(this.#seq, prepared.writes.length === 0 ? this.#seq : prepared.writes.at(-1).seq)

    // Our own writes echo through the changefeed without `replay`, so nothing
    // was marked dirty; but be explicit rather than rely on that.
    this.#dirtyUsage = false

    return { ...prepared.result, stats: this.#stats() }
  }

  #stats() {
    return { messageCount: this.#messageCount, usage: this.#usageTotal }
  }

  // --- queries ------------------------------------------------------------
  async getEntries(ids, _context) {
    this.#read()
    const found = new Map()
    for (const id of ids) {
      const entry = this.#entry(id)
      if (entry !== undefined) found.set(id, entry)
    }
    return found
  }

  async getValue(address, _context) {
    this.#read()
    return this.#storedValue(address.namespace, address.key)
  }

  async scanValues(prefix, _context) {
    this.#read()
    const out = []
    for (const [pkey, meta] of this.#valueSeq) {
      const raw = this.#doc.values.get(pkey)
      if (raw === undefined) continue
      if (raw.namespace !== prefix.namespace || !raw.key.startsWith(prefix.key)) continue
      out.push({ address: value(raw.namespace, raw.key), value: raw.value, seq: meta.seq })
    }
    return out.sort((a, b) => compareKeys(a.address.key, b.address.key))
  }

  async readList(address, options, _context) {
    this.#read()
    const resolved = resolveListReadOptions(options)
    const pkey = physicalKey(address.namespace, address.key)
    const ref = this.#doc.lists.at(pkey)
    if (ref === undefined) return []
    const seqs = this.#listSeq.get(pkey) ?? new Map()
    const elements = ref()
      .map((e) => ({ seq: seqs.get(e.eid), value: e.value }))
      .filter((e) => e.seq !== undefined)
      .sort((a, b) => a.seq - b.seq)
    const filtered = elements.filter((e) =>
      resolved.cursor === undefined
        ? true
        : resolved.order === "asc"
          ? e.seq > resolved.cursor.seq
          : e.seq < resolved.cursor.seq,
    )
    const ordered = resolved.order === "asc" ? filtered : [...filtered].reverse()
    return ordered.slice(0, resolved.limit)
  }

  async scanBranch(query, _context) {
    this.#read()
    const start = this.#entry(query.start)
    if (start === undefined) throw new Error(`Unknown branch start: ${query.start}`)

    const path = []
    let entry = start
    while (entry !== undefined) {
      path.push(entry)
      if (entry.parentId === null) break
      entry = this.#entry(entry.parentId)
      if (entry === undefined) throw new Error("Corrupt branch: missing parent")
    }
    if (query.order === "oldestFirst") path.reverse()

    const stopped = []
    for (const candidate of path) {
      stopped.push(candidate)
      if (candidate.id === query.stopAtId || candidate.type === query.stopAtType) break
    }

    const filtered = stopped
      .filter((c) => query.type === undefined || c.type === query.type)
      .filter((c) => query.customType === undefined || c.customType === query.customType)
      .filter(
        (c) =>
          query.cursor === undefined ||
          (query.order === "oldestFirst" ? c.seq > query.cursor.seq : c.seq < query.cursor.seq),
      )
    return query.limit === undefined ? filtered : filtered.slice(0, Math.max(0, query.limit))
  }

  async scanBranchStructure(query, context) {
    return (await this.scanBranch(query, context)).map((entry) => ({
      id: entry.id,
      parentId: entry.parentId,
      seq: entry.seq,
      timestamp: entry.timestamp,
      type: entry.type,
      ...(entry.customType === undefined ? {} : { customType: entry.customType }),
    }))
  }

  async scanEntries(query, _context) {
    this.#read()
    const limit = query.limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(query.limit))
    const order = this.#entryOrder // ascending seq by construction
    const out = []
    const descending = query.order === "desc"
    let index = descending ? order.length - 1 : 0
    while (index >= 0 && index < order.length && out.length < limit) {
      const id = order[index]
      const seq = this.#entrySeq.get(id)
      index += descending ? -1 : 1
      if (query.fromSeq !== undefined && seq < query.fromSeq) continue
      if (query.toSeq !== undefined && seq > query.toSeq) continue
      const raw = this.#doc.entries.get(id)
      if (raw === undefined) continue
      if (query.type !== undefined && raw.type !== query.type) continue
      if (query.customType !== undefined && raw.customType !== query.customType) continue
      out.push({ ...raw, seq })
    }
    return out
  }

  async scanUsage(query, _context) {
    this.#read()
    const rows = []
    for (const id of this.#usageOrder) {
      const seq = this.#usageSeq.get(id)
      if (query.fromSeq !== undefined && seq < query.fromSeq) continue
      if (query.toSeq !== undefined && seq > query.toSeq) continue
      const raw = this.#doc.usageRows.get(id)
      if (raw === undefined) continue
      rows.push({ ...raw, seq })
    }
    if (query.order === "desc") rows.reverse()
    return query.limit === undefined ? rows : rows.slice(0, Math.max(0, query.limit))
  }

  async getStats(_context) {
    this.#read()
    return this.#stats()
  }

  close(_context) {
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#state = "closing"
    this.#closePromise = this.#commitQueue.then(() => {
      this.#state = "closed"
      this.#unsubscribe?.()
    })
    return this.#closePromise
  }
}
