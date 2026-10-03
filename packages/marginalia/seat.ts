// seat — which person each seat is, as the host saw it (ADR-0037, ADR-0048).
//
// A text's operations carry their seat's Yjs `clientID`, which says who wrote
// them only to a peer that knows the seat's principal. A client's only peer is
// the host, and the host forgets a seat once it leaves. So the host writes a
// `pineta.seat` value per seat when it connects, keyed by its peer, and
// anyone derives a text's writers from its `clientID`s (`writersOf`) whenever
// they need them. Nobody stores a contributors list.

import type { SeatRecord, WriterId } from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, textKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const SeatSchema = Type.Object({
  clientId: Type.Number(),
  writer: Type.String(),
  at: Type.Number(),
})

/**
 * Each seat, at its Kyneta peer id: the seat's identity, as presence's
 * `seatKey` has it. The `clientID` is in the contents, since a text's
 * operations carry it and Yjs derives it from the peer (`seatOf`, in
 * `@pineta/schema`), which this package cannot.
 */
export const SEAT: RecordSpec<SeatRecord, string> = {
  namespace: "pineta.seat",
  keyOf: s => s.peer,
  encode: ({ peer, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(SeatSchema, contents, textKey(key), (s, peer) => ({
      peer,
      clientId: s.clientId,
      writer: s.writer as WriterId,
      at: s.at,
    })),
}

/**
 * The connected seats with no record yet, to write. `connected` is each seat
 * as `seatOf` (`@pineta/schema`) gives it: a seat that is nobody is not in it.
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
): SeatRecord[] {
  const named = new Set(clientIdsInTexts)
  return seats.filter(s => !named.has(s.clientId))
}
