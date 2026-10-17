import { type SeatRecord, writerId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { decodeRecords, setRecord } from "./records.ts"
import { planSeatSweep, planSeats, SEAT, writersOfClients } from "./seat.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const seat = (clientId: number, writer = ADA, at = clientId): SeatRecord => ({
  peer: `p-${clientId}`,
  clientId,
  writer,
  at,
})

test("planSeats: only the connected seats not stored yet", () => {
  expect(
    planSeats(
      [
        { peer: "p-1", clientId: 1, writer: ADA },
        { peer: "p-2", clientId: 2, writer: BEA },
      ],
      [seat(1)],
      50,
    ),
  ).toEqual([{ peer: "p-2", clientId: 2, writer: BEA, at: 50 }])
})

test("writersOfClients: each person once, in the order their seats were first seen; unknown ids are nobody", () => {
  const seats = [seat(3, ADA, 30), seat(1, BEA, 10), seat(2, ADA, 20)]
  expect(writersOfClients([2, 3, 1, 99], seats)).toEqual([BEA, ADA])
  expect(writersOfClients([99], seats)).toEqual([])
})

test("planSeatSweep: a seat no text names goes", () => {
  expect(planSeatSweep([seat(1), seat(2), seat(3)], [3, 1, 42])).toEqual([
    seat(2),
  ])
})

test("a seat round-trips at its peer; a malformed one is dropped", () => {
  const w = setRecord(SEAT, seat(7))
  expect(w.key).toBe("p-7")
  expect(SEAT.decode(JSON.parse(JSON.stringify(w.value)), w.key)).toEqual(
    seat(7),
  )
  expect(
    SEAT.decode({ clientId: "7", writer: "x", at: 1 }, "p-7"),
  ).toBeUndefined()
  expect([
    ...decodeRecords(SEAT, [w, { key: "p-8", value: "junk" }]).values(),
  ]).toEqual([seat(7)])
})

test("a seat stored under its clientId reads with that address as its peer, where a delete finds it", () => {
  const old = { key: "7", value: { clientId: 7, writer: ADA, at: 7 } }
  expect(decodeRecords(SEAT, [old]).get("7")).toEqual({ ...seat(7), peer: "7" })
})
