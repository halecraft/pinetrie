// seat — which person each seat is, as the host saw it (ADR-0037, ADR-0048).
//
// A text's operations carry their seat's Yjs `clientID`, which says who wrote
// them only to a peer that knows the seat's principal. A client's only peer is
// the host, and the host forgets a seat once it leaves. So the host writes a
// `pineta.seat` value per seat when it connects, keyed by `clientID`, and
// anyone derives a text's writers from its `clientID`s (`writersOf`) whenever
// they need them. Nobody stores a contributors list.

import type { SeatRecord, WriterId } from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

/** pi value namespace for seat records. The key is the seat's `clientID`. */
export const SEAT_NAMESPACE = "pineta.seat"

const SeatSchema = Type.Object({
  clientId: Type.Number(),
  writer: Type.String(),
  at: Type.Number(),
})

/** A seat record -> the plain value stored in pi. */
export const encodeSeat = (s: SeatRecord) => ({ ...s })

export const decodeSeat = (value: unknown): SeatRecord | undefined =>
  decodeWith(SeatSchema, value, s => ({ ...s, writer: s.writer as WriterId }))

/** Stored `pineta.seat` values -> the records, in the order the host first saw them. */
export const seatRecords = (
  values: Iterable<{ readonly value: unknown }>,
): readonly SeatRecord[] =>
  decodeAll(values, decodeSeat).sort((a, b) => a.at - b.at)

/**
 * The connected seats with no record yet, to write. `connected` is each seat
 * as `seatOf` (`@pineta/schema`) gives it: a seat that is nobody is not in it.
 */
export function planSeats(
  connected: readonly {
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
export function writersOf(
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
 * seat on every load (ADR-0037), so without this the records would grow with
 * every visit. Pure; the host's startup runs it over every text it holds.
 */
export function planSeatSweep(
  seats: readonly SeatRecord[],
  clientIdsInTexts: Iterable<number>,
): number[] {
  const named = new Set(clientIdsInTexts)
  return seats.filter(s => !named.has(s.clientId)).map(s => s.clientId)
}
