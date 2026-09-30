import { type SeatRecord, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import {
  authorsOf,
  decodeSeat,
  encodeSeat,
  planSeatSweep,
  planSeats,
  seatRecords,
  writersOf,
} from "./seat.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const seat = (clientId: number, writer = ADA, at = clientId): SeatRecord => ({
  clientId,
  writer,
  at,
})

test("planSeats: only the connected seats not stored yet", () => {
  expect(
    planSeats(
      [
        { clientId: 1, writer: ADA },
        { clientId: 2, writer: BEA },
      ],
      [seat(1)],
      50,
    ),
  ).toEqual([{ clientId: 2, writer: BEA, at: 50 }])
})

test("writersOf: each person once, in the order their seats were first seen; unknown ids are nobody", () => {
  const seats = [seat(3, ADA, 30), seat(1, BEA, 10), seat(2, ADA, 20)]
  expect(writersOf([2, 3, 1, 99], seats)).toEqual([BEA, ADA])
  expect(writersOf([99], seats)).toEqual([])
})

test("planSeatSweep: a seat no text names goes", () => {
  expect(planSeatSweep([seat(1), seat(2), seat(3)], [3, 1, 42])).toEqual([2])
})

test("a seat round-trips; a malformed one is dropped; records sort by first seen", () => {
  expect(decodeSeat(JSON.parse(JSON.stringify(encodeSeat(seat(7)))))).toEqual(
    seat(7),
  )
  expect(decodeSeat({ clientId: "7", writer: "x", at: 1 })).toBeUndefined()
  expect(
    seatRecords([
      { value: seat(2, ADA, 20) },
      { value: "junk" },
      { value: seat(1, BEA, 10) },
    ]).map(s => s.clientId),
  ).toEqual([1, 2])
})

test("authorsOf: each seat's person by clientID", () => {
  const authors = authorsOf([seat(1, ADA), seat(2, BEA)])
  expect([authors.get(1), authors.get(2), authors.get(3)]).toEqual([
    ADA,
    BEA,
    undefined,
  ])
})
