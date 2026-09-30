// schema — the Kyneta document shape.
//
// Imports Kyneta ONLY. Deliberately pi-free: this is what let S7/S8/S12 test
// convergence with no harness in the picture, and that property is worth
// keeping. Nothing here knows what pi is.

import { batch, createDoc, json, Schema } from "@kyneta/schema"
import { type StreamEvent, type TextEdit, tailEdit } from "@pineta/core"

/**
 * One entry as it sits in the document (ADR-0015).
 *
 * Six typed columns plus one sealed leaf. The columns are exactly what Pineta
 * itself reasons about: the tree edge, plus the fields `projectTranscript`,
 * `orderNewEntries` and fold read. Everything pi-specific stays in `payload`.
 *
 *   - `type` is an UNCONSTRAINED string on purpose. A new pi `EntryType` then
 *     needs no schema change here at all. A `discriminatedUnion` would demand
 *     one every time, and its discriminant must be a constrained literal.
 *   - `.json()` makes the whole entry ONE inert leaf: Kyneta classifies a
 *     `.json()` node as `register`, stored as a single tuple rather than
 *     decomposed into per-field state. That is exactly right for entries,
 *     which are written once and never edited (ADR-0004, ADR-0009), so
 *     per-field CRDT merge is machinery we would never use.
 *   - No `seq` column. ADR-0013 is now STRUCTURAL for stored entries: an
 *     undeclared key cannot be written through a typed struct, the same way
 *     `Schema.struct` already protects Line messages on the wire.
 *
 * `payload` is pi's variant data and ONLY that. It must never carry a copy of
 * a column above. See `toStoredRow` in `packages/pi/storage.ts`.
 */
const StoredEntryRowSchema = Schema.struct.json({
  id: Schema.string(),
  parentId: Schema.string().nullable(),
  type: Schema.string(),
  timestamp: Schema.number(),
  fromId: Schema.string().nullable(),
  payload: Schema.any(),
})

/**
 * One session document, replicated host -> client. Authoritative JSON
 * (`json.bind`, ADR-0023): the host is its only writer, clients send commands,
 * and it is compacted between runs, keeping its state and not its edits.
 *
 * entries / usageRows / values / lists back pi's `Storage` port.
 *
 *   - `entries` is a RECORD keyed by UUIDv7, not a list: each entry is written
 *     exactly once and never edited (ADR-0004, ADR-0009), so a keyed record is
 *     the whole of what is needed, and a retried write lands on the same key
 *     where a list would duplicate it.
 *   - `usageRows`, `values` and `lists` stay `Schema.any()`. They are pi's
 *     bookkeeping for its `Storage` port, not Pineta's domain model, and
 *     nothing of ours traverses them. The asymmetry with `entries` is
 *     deliberate: we type what we reason about.
 *
 * `streams` and `streamText` are what a running turn is writing right now: a
 * reply, or a tool's output, one `Schema.text()` per stream, written as edits
 * and deleted once its entry is written (ADR-0014, `planStream`). NOT `Schema.string()`: a whole-value
 * register is O(n^2) on every substrate, and stores every snapshot (S22).
 * `checkpointText` holds pi's tool-output checkpoints, written the same way by
 * `KynetaStorage`.
 */
export const SessionDoc = json.bind(
  Schema.struct({
    entries: Schema.record(StoredEntryRowSchema),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    // One per stream, keyed by a fresh uuidv7 (ADR-0016): which lane, a
    // reply or a tool, the tool's call, and the lane's tip when a reply
    // opened ("" for a tool, or a lane with none). A tool's label is its
    // call's, in the committed entry its row is drawn from. `StreamRecord`
    // is the typed read.
    streams: Schema.record(
      Schema.struct.json({
        lane: Schema.string(),
        kind: Schema.string("reply", "tool"),
        callId: Schema.string(),
        under: Schema.string(),
      }),
    ),
    streamText: Schema.record(Schema.text()),
    // pi's `pi.pending.tool_output` checkpoints' text, keyed by physicalKey.
    checkpointText: Schema.record(Schema.text()),
    // Which run each lane is streaming, keyed by lane name. A missing key
    // means that lane is idle; nothing is ever set to "" to mean idle. One
    // entry per lane is what lets two writers stream at once.
    activeRuns: Schema.record(Schema.string()),
  }),
)

export const newSessionDoc = () => createDoc(SessionDoc)

/**
 * A live handle on the session document.
 *
 * Derived from the value rather than hand-written, so the doc shape above stays
 * the single source of truth. `exchange.get(id, SessionDoc)` yields this exact
 * type, so host/ and client/ share it without restating anything.
 */
export type SessionDocHandle = ReturnType<typeof newSessionDoc>

// --- runs and streams (ADR-0014, S22, S55) --------------------------------

/** Mark a lane as running `runId`. Its streams open as it writes. */
export function beginRun(
  doc: SessionDocHandle,
  lane: string,
  runId: string,
): void {
  batch(doc, d => d.activeRuns.set(lane, runId))
}

/** The run a lane is running, or undefined when the lane is idle. */
export function readActiveRun(
  doc: SessionDocHandle,
  lane: string,
): string | undefined {
  return doc.activeRuns.get(lane) ?? undefined
}

/**
 * The run ended. The lane's key is DELETED, not set to "": absence is what
 * "idle" means. Its streams go in the same batch: every entry of the run is
 * already written (S55), and a stopped run's may never come.
 */
export function endRun(
  doc: SessionDocHandle,
  lane: string,
  runId: string,
): void {
  const closing = closeStreams(
    readStreamRecords(doc).filter(s => s.lane === lane),
  )
  batch(doc, d => {
    if (d.activeRuns.get(lane) !== runId) return
    d.activeRuns.delete(lane)
    applyOps(d, closing)
  })
}

/** A stream as stored, without its text. */
export type StreamRecord =
  | {
      readonly id: string
      readonly lane: string
      readonly kind: "reply"
      /** The lane's tip when the reply opened. */
      readonly under: string | null
    }
  | {
      readonly id: string
      readonly lane: string
      readonly kind: "tool"
      readonly callId: string
    }

/** A stream, with what it has written so far. */
export type Stream = StreamRecord & { readonly text: string }

/**
 * Whether `s` is its lane's reply being written now: the lane's tip has not
 * moved since it opened. The reply's own entry moves the tip, in the commit
 * that writes it (S35), so the entry and the end of this are one change. The
 * host appends to this reply, and the reader draws it.
 */
export const isCurrentReply = (s: StreamRecord, tip: string | null): boolean =>
  s.kind === "reply" && s.under === tip

export type StreamOp =
  | { readonly kind: "open"; readonly stream: StreamRecord }
  | {
      readonly kind: "edit"
      readonly id: string
      readonly edits: readonly TextEdit[]
    }
  | { readonly kind: "close"; readonly id: string }

/** Close each stream given: the one way a stream is deleted. */
export const closeStreams = (
  streams: readonly { readonly id: string }[],
): StreamOp[] => streams.map(s => ({ kind: "close", id: s.id }))

/**
 * What one stream event does to the document. Pure.
 *
 * A reply stream opens on its message's first text, `under` the lane's tip,
 * and takes the message's text while it is current (`isCurrentReply`). Nothing
 * happens when a message or a tool ends: a stream stays until its entry is
 * written, so a reader never sees neither. Streams go when they can no longer
 * be drawn: a new reply closes its lane's streams, whose entries are written
 * before its request (S55); a tool closes its lane's replies that are no longer
 * current. A tool's output arrives as whole snapshots of a view that keeps only
 * the tail, written as `tailEdit`s. An event for a lane that is not running
 * changes nothing.
 */
export function planStream(input: {
  readonly event: StreamEvent
  /** Every stream, with its text. */
  readonly streams: readonly Stream[]
  /** The event's lane's tip. */
  readonly tip: string | null
  readonly running: boolean
  readonly newId: () => string
}): readonly StreamOp[] {
  const { event, tip, running } = input
  if (!running) return []
  const mine = input.streams.filter(s => s.lane === event.lane)
  switch (event.kind) {
    case "text": {
      if (event.delta.length === 0) return []
      const reply = mine.find(s => isCurrentReply(s, tip))
      if (reply !== undefined)
        return [
          {
            kind: "edit",
            id: reply.id,
            edits: [{ at: reply.text.length, remove: 0, insert: event.delta }],
          },
        ]
      const id = input.newId()
      return [
        ...closeStreams(mine),
        {
          kind: "open",
          stream: { id, lane: event.lane, kind: "reply", under: tip },
        },
        {
          kind: "edit",
          id,
          edits: [{ at: 0, remove: 0, insert: event.delta }],
        },
      ]
    }
    case "toolStart":
      return [
        ...closeStreams(
          mine.filter(s => s.kind === "reply" && !isCurrentReply(s, tip)),
        ),
        {
          kind: "open",
          stream: {
            id: input.newId(),
            lane: event.lane,
            kind: "tool",
            callId: event.callId,
          },
        },
      ]
    case "toolOutput": {
      const tool = mine.find(
        s => s.kind === "tool" && s.callId === event.callId,
      )
      if (tool === undefined) return []
      const edits = tailEdit(tool.text, event.text)
      return edits.length === 0 ? [] : [{ kind: "edit", id: tool.id, edits }]
    }
  }
}

/** Apply `edits` to a Kyneta text: the one place text receives edits. */
export function applyTextEdits(
  ref: {
    insert(at: number, s: string): void
    delete(at: number, n: number): void
  },
  edits: readonly TextEdit[],
): void {
  for (const e of edits) {
    if (e.remove > 0) ref.delete(e.at, e.remove)
    if (e.insert.length > 0) ref.insert(e.at, e.insert)
  }
}

/** Apply `ops` inside a batch the caller has opened. */
function applyOps(d: SessionDocHandle, ops: readonly StreamOp[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case "open": {
        const s = op.stream
        d.streams.set(s.id, {
          lane: s.lane,
          kind: s.kind,
          callId: s.kind === "tool" ? s.callId : "",
          under: s.kind === "reply" ? (s.under ?? "") : "",
        })
        d.streamText.set(s.id, "")
        break
      }
      case "edit": {
        const ref = d.streamText.at(op.id)
        if (ref !== undefined) applyTextEdits(ref, op.edits)
        break
      }
      case "close":
        d.streams.delete(op.id)
        d.streamText.delete(op.id)
        break
    }
  }
}

/** The one place stream records and their text are written. */
export function applyStreamOps(
  doc: SessionDocHandle,
  ops: readonly StreamOp[],
): void {
  if (ops.length === 0) return
  batch(doc, d => applyOps(d, ops))
}

/** Every stream's record, in id order, without reading any text. */
export function readStreamRecords(
  doc: SessionDocHandle,
): readonly StreamRecord[] {
  return Object.entries(doc.streams())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([id, s]): StreamRecord =>
        s.kind === "tool"
          ? { id, lane: s.lane, kind: "tool", callId: s.callId }
          : { id, lane: s.lane, kind: "reply", under: s.under || null },
    )
}

/** What a stream has written so far; "" once it is gone. */
export const readStreamText = (doc: SessionDocHandle, id: string): string =>
  doc.streamText.at(id)?.() ?? ""

/** Every stream, with its text. */
export function readStreams(doc: SessionDocHandle): readonly Stream[] {
  return readStreamRecords(doc).map(s => ({
    ...s,
    text: readStreamText(doc, s.id),
  }))
}

/**
 * Nothing streams across a process: delete every stream, every text (one
 * whose record is gone included), and every running lane's key. A starting
 * host calls this before it drains any lane.
 */
export function clearStreams(doc: SessionDocHandle): void {
  const ids = new Set([
    ...Object.keys(doc.streams()),
    ...Object.keys(doc.streamText()),
  ])
  const closing = closeStreams([...ids].map(id => ({ id })))
  batch(doc, d => {
    applyOps(d, closing)
    for (const lane of Object.keys(d.activeRuns())) d.activeRuns.delete(lane)
  })
}

// --- read helpers used by the client ---------------------------------------

/**
 * One stored entry, derived from the schema rather than restated, so the shape
 * above stays the single source of truth.
 */
export type StoredEntryRow = ReturnType<SessionDocHandle["entries"]>[string]

/**
 * Write one entry row.
 *
 * Takes the TYPED row, not `unknown`: reading is receiving, where anything
 * might arrive, but writing is our own act and the shape can be demanded
 * (ADR-0015).
 *
 * The caller supplies `id`. Nothing here mints one, because entry-id
 * uniqueness is a safety invariant (ADR-0009) and a same-key write is
 * silently discarded by the per-key LWW register. Id minting stays with pi's
 * `IdGenerator`.
 */
export function writeEntry(doc: SessionDocHandle, row: StoredEntryRow): void {
  doc.entries.set(row.id, row)
}

export const readEntries = (
  doc: SessionDocHandle,
): Record<string, StoredEntryRow> => doc.entries()

/**
 * The record key for one of pi's values: `namespace`, a NUL, then `key`.
 *
 * pi addresses a value by a (namespace, key) pair; that pair is pi's. Folding
 * it into ONE record key is ours: `values` is a flat record, so each address
 * becomes one leaf register and there is no child container to race when two
 * replicas write a new namespace at once (S18, ADR-0016). NUL is the
 * separator pi's own in-memory storage uses; it cannot appear in a namespace,
 * and it sorts first, so one namespace's keys are adjacent.
 *
 * The key is an IDENTITY, not a format to read back. It is built here and
 * nowhere else, and never parsed: every stored value also carries its
 * `namespace` and `key` as properties, and readers use those.
 */
export const physicalKey = (namespace: string, key: string): string =>
  `${namespace}\u0000${key}`

/** pi's namespace for lane tips, keyed by lane name (a thread's, ADR-0020). pi's name. */
const LANE_TIP = "pi.branch.tip"

/** A stored value's own record of its address and contents. */
interface StoredAddress {
  readonly namespace?: unknown
  readonly key?: unknown
  readonly value?: unknown
}
const asStored = (v: unknown): StoredAddress | undefined =>
  v !== null && typeof v === "object" ? (v as StoredAddress) : undefined

/**
 * Whether the document records a lane named `lane` at all.
 *
 * This is the only way to tell "no lane" from "a lane at the root": pi writes
 * the lane's tip value when it creates a lane, null until the lane has an
 * entry, so `readLaneTip` returns null for both. Measured, not assumed: see
 * `packages/pi/TECHNICAL.md`.
 */
export function hasLaneRecord(doc: SessionDocHandle, lane: string): boolean {
  return doc.values.get(physicalKey(LANE_TIP, lane)) !== undefined
}

/** A lane's tip entry id, or null if the lane has none (or does not exist). */
export function readLaneTip(
  doc: SessionDocHandle,
  laneName: string,
): string | null {
  const value = asStored(doc.values.get(physicalKey(LANE_TIP, laneName)))?.value
  return typeof value === "string" ? value : null
}

/**
 * Every lane the document records. Read from each value's own `namespace` and
 * `key` properties, never by splitting the record key.
 */
export function readLaneNames(doc: SessionDocHandle): string[] {
  return readValues(doc, LANE_TIP).map(v => v.key)
}

/**
 * Every value in `namespace`, read from each value's own `namespace` and `key`
 * properties. Never parses a record key: the key is an identity (ADR-0016).
 */
export function readValues(
  doc: SessionDocHandle,
  namespace: string,
): { readonly key: string; readonly value: unknown }[] {
  const out: { key: string; value: unknown }[] = []
  for (const stored of Object.values(doc.values())) {
    const s = asStored(stored)
    if (s?.namespace === namespace && typeof s.key === "string")
      out.push({ key: s.key, value: s.value })
  }
  return out
}

/**
 * An entry's message, lifted out of its sealed `payload` (ADR-0015), or
 * undefined if the entry is absent or carries none. The one definition of
 * where a message lives in a stored row; the client's projection and the
 * host both read through it.
 */
export function readEntryMessage(
  doc: SessionDocHandle,
  id: string,
): { present: false } | { present: true; message: unknown } {
  const row = doc.entries.get(id)
  return row === undefined || row === null
    ? { present: false }
    : { present: true, message: rowMessage(row) }
}

/** A row's message, lifted out of its sealed `payload`. Pure; no lookup. */
export const rowMessage = (row: StoredEntryRow): unknown =>
  (row.payload as { message?: unknown } | null)?.message

export * from "./note.ts"
export * from "./presence.ts"
