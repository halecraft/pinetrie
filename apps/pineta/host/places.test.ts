import { atEntry, cardId, entryId, writerId } from "@pineta/core"
import { readPlaces, readPlacesRev } from "@pineta/reads"
import { newPlacesDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { applyPlaceStep } from "./places.ts"

test("applyPlaceStep: one rev per write and per removal, in the same batch as the record (ADR-0059)", () => {
  const places = newPlacesDoc()
  const ada = writerId("ada@x.io")
  const record = {
    id: cardId("c-1"),
    owner: ada,
    placer: ada,
    place: { kind: "drafting", at: atEntry(entryId("e-1")), lane: null },
    command: null,
    unsent: null,
  } as const
  expect(applyPlaceStep(places, { kind: "write", record })).toBe(1)
  expect(readPlaces(places)).toEqual([record])
  expect(applyPlaceStep(places, { kind: "remove", id: record.id })).toBe(2)
  expect([readPlaces(places), readPlacesRev(places)]).toEqual([[], 2])
})
