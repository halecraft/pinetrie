// schema/presence — who is here, what each person reads, and who is typing.
//
// Kyneta's `ephemeral` target (ADR-0024): never stored, last writer wins per
// field, and `.decay(ms)` reverts a field to its zero when no fresh write
// arrives. The fields are nullable, so that zero is `null`, not a sentinel
// string. Leaving needs no message: a person's entries go quiet and decay. A
// decayed key stays in the record holding `null`, and a peer that shuts down
// is not removed at once; readers skip nulls. Each client writes only its own
// keys; nothing can enforce that, so presence is untrusted, like the
// principals it names.
//
// Records are flat and keyed by what writes them (ADR-0016's rule, kept though
// presence cannot race harmfully). A person may be here from several tabs or
// devices, each its own seat (ADR-0037), so every key starts with the seat's
// `seatKey`, `${writer}:${seat}`: one tab never overwrites or clears
// another's. `reading` adds the column, `${seatKey}:${columnKey}`, since every
// open column is being read; `typing` and `editing` are keyed by `seatKey`.
// The writer must be in the key: a browser sees only the host among its
// peers, so it cannot look another tab's person up from its seat.

import { createDoc, ephemeral, Schema } from "@kyneta/schema"

export interface PresenceDecay {
  /** How long reading and editing last without a refresh. */
  readonly presenceMs: number
  /** How long typing lasts without another keystroke. */
  readonly typingMs: number
}

/** Refreshed every 10 s while a page is visible, so 30 s survives two misses. */
export const PRESENCE_DECAY: PresenceDecay = {
  presenceMs: 30_000,
  typingMs: 3_000,
}

/**
 * The presence document's shape for a given decay. Documents bound with
 * different decays still sync (their schema hashes differ, and Kyneta reads
 * across them), which is what lets a suite shorten the decay.
 */
export const presenceSchema = (d: PresenceDecay) =>
  Schema.struct({
    /** Keyed `${writer}:${columnKey}`: the end of the thread that column follows. */
    reading: Schema.record(Schema.string().nullable().decay(d.presenceMs)),
    /** Keyed by writer: the thread end whose composer they are typing in. */
    typing: Schema.record(Schema.string().nullable().decay(d.typingMs)),
    /** Keyed by writer: the note they are editing. */
    editing: Schema.record(Schema.string().nullable().decay(d.presenceMs)),
  })

export const presenceDoc = (d: PresenceDecay = PRESENCE_DECAY) =>
  ephemeral.bind(presenceSchema(d))

export const PresenceDoc = presenceDoc()

export const newPresenceDoc = () => createDoc(PresenceDoc)

/** A live handle on the presence document, derived as `SessionDocHandle` is. */
export type PresenceDocHandle = ReturnType<typeof newPresenceDoc>

/**
 * The key of one seat's entries: its person, then the seat (ADR-0037). A
 * writer holds no `:` (`normalizeEmail` refuses it) and a seat is hex, so the
 * writer is everything before the first `:` (`writerOfKey`).
 */
export const seatKey = (writer: string, seat: string): string =>
  `${writer}:${seat}`

/** The key of one column's reading entry: its seat's key, then the column. */
export const readingKey = (ofSeat: string, columnKey: string): string =>
  `${ofSeat}:${columnKey}`

/** The writer of any presence key: everything before its first `:`. */
export const writerOfKey = (key: string): string | undefined => {
  const at = key.indexOf(":")
  return at > 0 ? key.slice(0, at) : undefined
}
