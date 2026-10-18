// card-history — each card's history, and the traces left where someone else
// moved your card.

import {
  asPlaceFields,
  type CardId,
  type CardPlace,
  type CardRecord,
  type EntryId,
  entryId,
  isThreadId,
  keyOfFields,
  livePlace,
  ownerCard,
  type PlaceFields,
  type PlaceKey,
  parseCardId,
  placeFields,
  placeKey,
  sameKey,
  surfaceOwner,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { placeEnd } from "./card.ts"
import { decodeRecord, textKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The most events a card's history keeps: its first, and the newest. */
export const HISTORY_EVENTS = 50

/** How long a trace no one has seen is kept. */
export const TRACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// ── the records ───────────────────────────────────────────────────────────

const Str = Type.String()
const FieldsSchema = Type.Object({
  kind: Str,
  at: Str,
  lane: Str,
  column: Str,
  order: Str,
  by: Str,
  seen: Str,
  holder: Str,
  /** Absent from an event stored before canvases: read as "". */
  canvas: Type.Optional(Str),
  width: Type.Optional(Str),
  /** Absent from an event stored before canvases were cards: read as "". */
  state: Type.Optional(Str),
})
const OrNull = <T extends ReturnType<typeof Type.Object>>(t: T) =>
  Type.Union([t, Type.Null()])

const EventSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("created"),
    Type.Literal("moved"),
    Type.Literal("undone"),
    Type.Literal("redone"),
    Type.Literal("unsent"),
  ]),
  by: Type.Union([Str, Type.Null()]),
  from: OrNull(FieldsSchema),
  to: FieldsSchema,
  at: Type.Number(),
})
const HistorySchema = Type.Object({ events: Type.Array(EventSchema) })

const TraceSchema = Type.Object({
  for: Type.String({ minLength: 1 }),
  card: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  from: FieldsSchema,
  to: OrNull(FieldsSchema),
  message: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  at: Type.Number(),
})

const keyFields = (k: PlaceKey | null): PlaceFields | null =>
  k === null ? null : placeFields(k)
const keyOrNull = (
  f: Partial<PlaceFields> | null,
): PlaceKey | null | undefined =>
  f === null ? null : keyOfFields(asPlaceFields(f))

/**
 * One change to a living card's place: who made it, from where to where, and
 * when. What the change was called (queued, took into the inventory, pinned) is
 * read from the two places when it is worded (`changeVerb`).
 */
export interface CardEvent {
  readonly kind: "created" | "moved" | "undone" | "redone" | "unsent"
  /** Who made it; null for the host's own write. */
  readonly by: WriterId | null
  readonly from: PlaceKey | null
  readonly to: PlaceKey
  readonly at: number
}

/**
 * A card's history: a host-written `pinetrie.card-history` value in the
 * session, keyed by the card, and deleted with it.
 */
export interface CardHistoryRecord {
  readonly card: CardId
  /** Oldest first; at most `HISTORY_EVENTS`, the first always kept. */
  readonly events: readonly CardEvent[]
}

/**
 * The places a trace is left at: a thread's queue and its pinned cards, at the
 * thread's end, where its column draws it. A note moved by someone else leaves
 * none: a note column is everyone's scratch. Each has its drawer in
 * `@pinetrie/rules`' `TRACED`.
 */
type TracedKind = "queued" | "pinned"

/** Where a trace was left: a key of a place in `TracedKind`. */
export type TracedPlace = Extract<PlaceKey, { readonly kind: TracedKind }>

/**
 * What stays where your card was when someone else moved it, while you were not
 * looking: a host-written `pinetrie.trace` value in the session, keyed by its
 * own id, since it outlives its card. Drawn only for its placer, and deleted
 * once they have seen it.
 */
export interface TraceRecord {
  readonly id: string
  /** The card's placer before it moved: the one person it is drawn for. */
  readonly for: WriterId
  readonly card: CardId
  readonly by: WriterId
  readonly from: TracedPlace
  /** Where the card went; null when it was sent. */
  readonly to: PlaceKey | null
  /** The message a send wrote; null for any other move. */
  readonly message: EntryId | null
  readonly at: number
}

/**
 * Each card's history, at the card's id. An event whose place this build
 * cannot read is dropped, not the history.
 */
export const CARD_HISTORY: RecordSpec<CardHistoryRecord, CardId, "session"> = {
  namespace: "pinetrie.card-history",
  home: "session",
  keyOf: r => r.card,
  encode: ({ events }) => ({
    events: events.map(e => ({
      ...e,
      from: keyFields(e.from),
      to: placeFields(e.to),
    })),
  }),
  decode: (contents, key) =>
    decodeRecord(HistorySchema, contents, textKey(key), (r, id) => {
      const card = parseCardId(id)
      return card === undefined
        ? undefined
        : {
            card,
            events: r.events.flatMap(e => {
              const from = keyOrNull(e.from)
              const to = keyOfFields(asPlaceFields(e.to))
              return from === undefined || to === undefined
                ? []
                : [{ ...e, by: e.by as WriterId | null, from, to }]
            }),
          }
    }),
}

/** Each trace, at its own id. */
export const TRACE: RecordSpec<TraceRecord, string, "session"> = {
  namespace: "pinetrie.trace",
  home: "session",
  keyOf: r => r.id,
  encode: ({ id, ...t }) => ({
    ...t,
    from: placeFields(t.from),
    to: keyFields(t.to),
  }),
  decode: (contents, key) =>
    decodeRecord(TraceSchema, contents, textKey(key), (r, id) => {
      const key = keyOfFields(asPlaceFields(r.from))
      // A trace is left only at a traced place (`TRACED`).
      const from = key === undefined ? null : tracedKey(key)
      const to = keyOrNull(r.to)
      const card = parseCardId(r.card)
      return from === null || to === undefined || card === undefined
        ? undefined
        : {
            id,
            for: r.for as WriterId,
            card,
            by: r.by as WriterId,
            from,
            to,
            message: r.message === null ? null : entryId(r.message),
            at: r.at,
          }
    }),
}

// ── what a change was ─────────────────────────────────────────────────────

/** What a change to a card's place is called (`historyWords`, `traceWords`). */
export type Verb =
  | "created"
  | "sent"
  | "queued"
  | "unqueued"
  | "pinned"
  | "unpinned"
  | "took-into-inventory"
  | "put"
  | "discarded"
  | "moved"

/**
 * Where a trace left at each traced place (`TracedKind`) is drawn: the
 * thread end the card was at, which its column draws it at. A row for each,
 * so a place traced with no drawer does not compile: a trace no column
 * draws is never written.
 */
export const TRACED: {
  readonly [K in TracedKind]: (
    from: Extract<TracedPlace, { readonly kind: K }>,
    index: TreeIndex,
  ) => EntryId | null
} = {
  queued: (from, index) => placeEnd(from, index),
  pinned: (from, index) => placeEnd(from, index),
}

/**
 * A place a card moved out of leaves a trace at (`TracedKind`), as its key;
 * null for one it leaves none at.
 */
function tracedKey(p: CardPlace | PlaceKey): TracedPlace | null {
  switch (p.kind) {
    case "queued":
      return { kind: "queued", thread: p.thread, seen: p.seen }
    case "pinned":
      return { kind: "pinned", thread: p.thread }
    default:
      return null
  }
}

/** The thread end a trace left at `from` is drawn at (`TRACED`); null for none. */
export const traceEnd = (
  from: TracedPlace,
  index: TreeIndex,
): EntryId | null =>
  from.kind === "queued"
    ? TRACED.queued(from, index)
    : TRACED.pinned(from, index)

/**
 * Out of a queue or a thread's or a canvas's pinned cards to a note: an
 * unqueue or an unpin, to the nearest note column, which leaves
 * no trace.
 */
function movedBack(
  from: PlaceKey,
  to: PlaceKey,
): "unqueued" | "unpinned" | null {
  if (to.kind !== "note") return null
  switch (from.kind) {
    case "queued":
      return "unqueued"
    case "pinned":
    case "canvas-pinned":
      return "unpinned"
    default:
      return null
  }
}

/** The one rule for what a change is called, from its two places. */
export function changeVerb(from: PlaceKey | null, to: PlaceKey | null): Verb {
  if (to === null) return "sent"
  if (from === null) return "created"
  const back = movedBack(from, to)
  if (back !== null) return back
  if (to.kind === "trash") return "discarded"
  if (to.kind === "queued") return "queued"
  if (to.kind === "pinned" || to.kind === "canvas-pinned") return "pinned"
  if (to.kind === "inventory") return "took-into-inventory"
  if (from.kind === "inventory") return "put"
  return "moved"
}

/**
 * Who moved a card back below the line, when that is the last thing that
 * happened to it and it was not its owner: its heading says "unqueued by
 * Bea". Null otherwise.
 */
export function movedBackBy(
  history: CardHistoryRecord | undefined,
  owner: WriterId,
): { readonly verb: "unqueued" | "unpinned"; readonly by: WriterId } | null {
  const last = history?.events.at(-1)
  if (last === undefined || last.kind !== "moved") return null
  if (last.by === null || last.by === owner || last.from === null) return null
  const verb = movedBack(last.from, last.to)
  return verb === null ? null : { verb, by: last.by }
}

// ── the plan ──────────────────────────────────────────────────────────────

/** Why the places changed: who did it, when a person did. */
export type Cause =
  | { readonly kind: "move"; readonly by: WriterId }
  | { readonly kind: "undo" | "redo"; readonly by: WriterId }
  | {
      readonly kind: "spend"
      readonly by: WriterId
      /** The message the send wrote, when the host can find it. */
      readonly message: EntryId | null
    }
  | { readonly kind: "queued-busy"; readonly by: WriterId }
  /** The host's own write: a popped queued card, an unsent card, followers, a sweep. */
  | { readonly kind: "host" }

/** A write to one of the two records, or its removal. */
export type RecordStep<R, K> =
  | { readonly kind: "set"; readonly record: R }
  | { readonly kind: "delete"; readonly key: K }

export interface ProvenanceSteps {
  readonly histories: readonly RecordStep<CardHistoryRecord, CardId>[]
  readonly traces: readonly RecordStep<TraceRecord, string>[]
}

const byOf = (cause: Cause): WriterId | null =>
  cause.kind === "host" ? null : cause.by

function eventKind(
  cause: Cause,
  before: CardRecord,
  after: CardRecord,
): CardEvent["kind"] {
  if (cause.kind === "undo") return "undone"
  if (cause.kind === "redo") return "redone"
  if (cause.kind !== "host") return "moved"
  if (
    after.kind === "text" &&
    after.content.unsent !== null &&
    before.place.kind === "queued"
  )
    return "unsent"
  return "moved"
}

/** `events` and one more, the first always kept. */
const appended = (
  events: readonly CardEvent[],
  event: CardEvent,
): readonly CardEvent[] => {
  const all = [...events, event]
  return all.length <= HISTORY_EVENTS
    ? all
    : [all[0] as CardEvent, ...all.slice(all.length - (HISTORY_EVENTS - 1))]
}

/**
 * What a write to the places means for each card's history and for traces,
 * from the cards before and after it:
 * - a card that appeared is created; one whose place changed gets an event;
 *   one that went has its history deleted;
 * - a trace is left for the card's placer when someone else moved it out of
 *   a shared place while the placer had no column open at its thread's end
 *   (`reading`, `ends`), unless it was an unqueue or an unpin, or the host's
 *   own write;
 * - a trace whose card is back where the trace is goes.
 */
export function planProvenance(input: {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly cause: Cause
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly traces: readonly TraceRecord[]
  /** Each pair of person and thread end a column of theirs is open at. */
  readonly reading: readonly (readonly [WriterId, EntryId])[]
  /** Each shared card's thread end before the write; absent when unknown. */
  readonly ends: ReadonlyMap<CardId, EntryId | null>
  readonly now: number
  readonly newId: () => string
}): ProvenanceSteps {
  const { cause, now } = input
  const by = byOf(cause)
  const before = new Map(input.before.map(c => [c.id, c] as const))
  const after = new Map(input.after.map(c => [c.id, c] as const))
  const histories: RecordStep<CardHistoryRecord, CardId>[] = []
  const traces: RecordStep<TraceRecord, string>[] = []

  const watched = (placer: WriterId, card: CardId): boolean => {
    const end = input.ends.get(card)
    return (
      end !== undefined &&
      end !== null &&
      input.reading.some(([w, e]) => w === placer && e === end)
    )
  }

  for (const [id, is] of after) {
    const was = before.get(id)
    const to = placeKey(is.place)
    if (was === undefined) {
      histories.push({
        kind: "set",
        record: {
          card: id,
          events: [{ kind: "created", by, from: null, to, at: now }],
        },
      })
      continue
    }
    const from = placeKey(was.place)
    if (sameKey(from, to)) continue
    histories.push({
      kind: "set",
      record: {
        card: id,
        events: appended(input.histories.get(id)?.events ?? [], {
          kind: eventKind(cause, was, is),
          by,
          from,
          to,
          at: now,
        }),
      },
    })
    for (const t of input.traces)
      if (t.card === id && sameKey(t.from, to))
        traces.push({ kind: "delete", key: t.id })
  }

  for (const [id, was] of before) {
    const is = after.get(id)
    if (is === undefined && input.histories.has(id))
      histories.push({ kind: "delete", key: id })
    // A trace: someone else moved it out of a traced place, unseen.
    const from = tracedKey(was.place)
    if (by === null || by === was.placer || from === null) continue
    const to = is === undefined ? null : placeKey(is.place)
    if (to !== null && (sameKey(from, to) || movedBack(from, to) !== null))
      continue
    if (watched(was.placer, id)) continue
    traces.push({
      kind: "set",
      record: {
        id: input.newId(),
        for: was.placer,
        card: id,
        by,
        from,
        to,
        message: to === null && cause.kind === "spend" ? cause.message : null,
        at: now,
      },
    })
  }
  return { histories, traces }
}

/**
 * How long a trashed card is kept for a restore or the undo key to bring
 * back. Read only where the sweep and the page are wired: everything else
 * takes the keep as an input, and words it from its value, so a keep set
 * otherwise changes no rule and no word.
 */
export const TRASH_KEEP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * When a trashed card was trashed: its newest history event (its discard, or
 * what came after); `now` for one with no history to tell.
 */
export function trashedTime(
  card: CardId,
  histories: ReadonlyMap<CardId, CardHistoryRecord>,
  now: number,
): number {
  return histories.get(card)?.events.at(-1)?.at ?? now
}

/**
 * When a trashed card is deleted: `keepMs` after it was trashed, or `now`
 * for one with no history to tell. The sweep and the canvas column's list of
 * its trash both read it.
 */
export function trashDeadline(
  card: CardId,
  histories: ReadonlyMap<CardId, CardHistoryRecord>,
  now: number,
  keepMs: number,
): number {
  return histories.get(card) === undefined
    ? now
    : trashedTime(card, histories, now) + keepMs
}

/** What the trash sweep deletes: the cards, and among them the threads, whose lanes go too. */
export interface TrashSweep {
  readonly cards: readonly CardId[]
  readonly threads: readonly ThreadId[]
}

/**
 * The cards to delete, record and text: each trashed card past its
 * `trashDeadline`, and with it every card on a surface it owns
 * (`surfaceOwner`), trashed or not, and so on down: a note column's notes, a
 * thread's message, pinned, queued and margin cards.
 */
export function planTrashSweep(input: {
  readonly cards: readonly CardRecord[]
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly now: number
  /** How long a trashed card is kept (`TRASH_KEEP_MS`). */
  readonly keepMs: number
}): TrashSweep {
  const doomed = new Set<CardId>(
    input.cards
      .filter(
        c =>
          c.place.kind === "trash" &&
          trashDeadline(c.id, input.histories, input.now, input.keepMs) <=
            input.now,
      )
      .map(c => c.id),
  )
  // Down the owners: each pass adds the cards on a surface a doomed card owns.
  for (let grew = true; grew; ) {
    grew = false
    for (const c of input.cards) {
      if (doomed.has(c.id)) continue
      const owner = ownerCard(surfaceOwner(livePlace(c.place)))
      if (owner !== null && doomed.has(owner)) {
        doomed.add(c.id)
        grew = true
      }
    }
  }
  const cards = input.cards.filter(c => doomed.has(c.id)).map(c => c.id)
  return { cards, threads: cards.filter(isThreadId) }
}

/**
 * What the sweep removes: traces no one has seen in `TRACE_MAX_AGE_MS`, and
 * histories whose card has no record (a crash between the places write and
 * the history's).
 */
export function planTraceSweep(input: {
  readonly traces: readonly TraceRecord[]
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly cards: readonly CardRecord[]
  readonly now: number
}): ProvenanceSteps {
  const live = new Set<CardId>(input.cards.map(c => c.id))
  return {
    traces: input.traces
      .filter(t => input.now - t.at > TRACE_MAX_AGE_MS)
      .map(t => ({ kind: "delete", key: t.id })),
    histories: [...input.histories.keys()]
      .filter(id => !live.has(id))
      .map(key => ({ kind: "delete", key })),
  }
}
