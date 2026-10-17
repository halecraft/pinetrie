// schema/presence — who is here, what each person reads, and who is typing.
//
// Kyneta's `ephemeral` target: never stored, last writer wins per
// field, and `.decay(ms)` reverts a field to its zero when no fresh write
// arrives. The fields are nullable, so that zero is `null`, not a sentinel
// string. Leaving needs no message: a person's entries go quiet and decay. A
// decayed key stays in the record holding `null`, and a peer that shuts down
// is not removed at once; readers skip nulls. Each client writes only its own
// keys; nothing can enforce that, so presence is untrusted, like the
// principals it names.
//
// Records are flat and keyed by what writes them, the rule for any
// collaborative document's children, kept though presence cannot race
// harmfully. A person may be here from several tabs or devices, each its own
// seat, so every key starts with the seat's
// `seatKey`, `${writer}:${seat}`: one tab never overwrites or clears
// another's. `reading` adds the column, `${seatKey}:${columnKey}`, since every
// open column is being read; `typing` and `typingIn` are keyed by `seatKey`.
// The writer must be in the key: a browser sees only the host among its
// peers, so it cannot look another tab's person up from its seat.

import {
  type BoundSchema,
  type DocRef,
  ephemeral,
  Schema,
} from "@kyneta/schema"

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
    /** Keyed `${writer}:${columnKey}`: the end of the thread that column shows. */
    reading: Schema.record(Schema.string().nullable().decay(d.presenceMs)),
    /**
     * Keyed as `reading`: the task the column is on, so the sidebar and the
     * board name readers by task, and a window that does not hold the
     * thread's root can still name it.
     */
    readingTask: Schema.record(Schema.string().nullable().decay(d.presenceMs)),
    /** Keyed by writer: the thread end whose composer they are typing in. */
    typing: Schema.record(Schema.string().nullable().decay(d.typingMs)),
    /**
     * Keyed as `typing`: the card they are typing in. The host pops no card
     * someone is typing in, and drains again once this
     * decays.
     */
    typingIn: Schema.record(Schema.string().nullable().decay(d.typingMs)),
  })

export const presenceDoc = (d: PresenceDecay = PRESENCE_DECAY) =>
  ephemeral.bind(presenceSchema(d))

export const PresenceDoc = presenceDoc()

/** A live handle on the presence document. */
export type PresenceDocHandle =
  typeof PresenceDoc extends BoundSchema<infer S, infer N>
    ? DocRef<S, N>
    : never

/**
 * The key of one seat's entries: its person, then the seat. A
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
