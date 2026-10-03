import { atEntry, cardId, entryId, rootIdFor, writerId } from "@pineta/core"
import { readPlaces, readPlacesRev } from "@pineta/reads"
import { newPlacesDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { applyPlaceStep } from "./places.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

test("applyPlaceStep: one rev per write and per removal, in the same batch as the record (ADR-0059)", () => {
  const places = newPlacesDoc()
  const ada = writerId("ada@x.io")
  const record = {
    id: cardId("c-1"),
    owner: ada,
    placer: ada,
    place: {
      kind: "drafting",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: null,
    },
    command: null,
    unsent: null,
  } as const
  expect(applyPlaceStep(places, { kind: "write", record })).toBe(1)
  expect(readPlaces(places)).toEqual([record])
  expect(applyPlaceStep(places, { kind: "remove", id: record.id })).toBe(2)
  expect([readPlaces(places), readPlacesRev(places)]).toEqual([[], 2])
})
