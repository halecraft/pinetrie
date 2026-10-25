// seat — which person each seat is, as the host saw it.

import type { WriterId } from "@pinetrie/core"
import { Type } from "typebox"
import { recordDecoder, textKey, WriterIdSchema } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const SeatSchema = Type.Object({
  clientId: Type.Number(),
  writer: WriterIdSchema,
  at: Type.Number(),
})

/**
 * A seat the host has seen: its Kyneta peer, the Yjs `clientID` its operations
 * carry, and the person it is. A host-written `pinetrie.seat` value keyed by
 * the peer, so anyone can name who wrote in a text after the seat has gone.
 */
export interface SeatRecord {
  readonly peer: string
  readonly clientId: number
  readonly writer: WriterId
  /** When the host first saw it, which orders contributors. */
  readonly at: number
}

/**
 * Each seat, at its Kyneta peer id: the seat's identity, as presence's
 * `seatKey` has it. The `clientID` is in the contents, since a text's
 * operations carry it and Yjs derives it from the peer (`seatIdentity`, in
 * `@pinetrie/schema`), which this package cannot.
 */
export const SEAT: RecordSpec<
  SeatRecord,
  string,
  "session",
  typeof SeatSchema
> = {
  namespace: "pinetrie.seat",
  home: "session",
  keyOf: s => s.peer,
  encode: ({ peer, ...contents }) => contents,
  decode: recordDecoder(SeatSchema, textKey, (s, peer) => ({
    peer,
    clientId: s.clientId,
    writer: s.writer,
    at: s.at,
  })),
}

/**
 * The connected seats with no record yet, to write. `connected` is each seat
 * as `seatIdentity` (`@pinetrie/schema`) gives it: a seat that is nobody is not in it.
 */
export function planSeats(
  connected: readonly {
    readonly peer: string
    readonly clientId: number
    readonly writer: WriterId
  }[],
  stored: readonly SeatRecord[],
  now: number,
): readonly SeatRecord[] {
  const known = new Set(stored.map(s => s.clientId))
  return connected
    .filter(s => !known.has(s.clientId))
    .map(s => ({ ...s, at: now }))
}

/**
 * The people behind a text's `clientID`s: each once, in the order their seats
 * were first seen. A `clientID` with no record is nobody.
 */
export function writersOfClients(
  clientIds: readonly number[],
  seats: readonly SeatRecord[],
): readonly WriterId[] {
  const wrote = new Set(clientIds)
  const out: WriterId[] = []
  for (const s of [...seats].sort((a, b) => a.at - b.at))
    if (wrote.has(s.clientId) && !out.includes(s.writer)) out.push(s.writer)
  return out
}

/**
 * Seat records no stored text names, to delete. A store-less client is a new
 * seat on every load, so without this the records would grow with
 * every visit. The host's startup runs it over every text it holds.
 */
export function planSeatSweep(
  seats: readonly SeatRecord[],
  clientIdsInTexts: Iterable<number>,
): SeatRecord[] {
  const named = new Set(clientIdsInTexts)
  return seats.filter(s => !named.has(s.clientId))
}
