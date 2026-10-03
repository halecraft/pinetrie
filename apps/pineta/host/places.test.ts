import { atEntry, cardId, entryId, rootIdFor, writerId } from "@pineta/core"
import { readPlaces, readPlacesRev } from "@pineta/reads"
import { newPlacesDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { applyPlaceSteps } from "./places.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const ada = writerId("ada@x.io")
const record = (id: string) =>
  ({
    id: cardId(id),
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
  }) as const

test("applyPlaceSteps: one rev per batch of writes and removals (ADR-0059)", () => {
  const places = newPlacesDoc()
  const [a, b] = [record("c-1"), record("c-2")]
  expect(
    applyPlaceSteps(places, [
      { kind: "write", record: a },
      { kind: "write", record: b },
    ]),
  ).toBe(1)
  expect(readPlaces(places)).toEqual([a, b])
  expect(applyPlaceSteps(places, [{ kind: "remove", id: a.id }])).toBe(2)
  expect([readPlaces(places), readPlacesRev(places)]).toEqual([[b], 2])
  // No steps: nothing written, `rev` as it was.
  expect(applyPlaceSteps(places, [])).toBe(2)
})

test("applyPlaceSteps: inside a gesture, rev is raised outside it (S82)", () => {
  const places = newPlacesDoc()
  const inside: number[] = []
  const gesture = <T>(write: () => T): T => {
    const out = write()
    inside.push(readPlacesRev(places))
    return out
  }
  expect(
    applyPlaceSteps(
      places,
      [{ kind: "write", record: record("c-1") }],
      gesture,
    ),
  ).toBe(1)
  // The gesture saw its record written and `rev` not yet raised.
  expect(inside).toEqual([0])
  expect(readPlaces(places)).toHaveLength(1)
})
