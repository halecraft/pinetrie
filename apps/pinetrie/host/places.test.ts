import {
  atEntry,
  entryId,
  PLAIN,
  rootIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { readPlaces, readPlacesRev } from "@pinetrie/reads"
import { newPlacesDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { applyPlaceSteps } from "./places.ts"

const TEST_THREAD = threadIdFor("e")

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const ada = writerId("ada@x.io")
const record = (id: string) =>
  ({
    kind: "text" as const,
    id: textCardId(id),
    owner: ada,
    placer: ada,
    place: {
      kind: "composing",
      at: atEntry(entryId("e-1")),
      thread: TEST_THREAD,
    },
    carries: PLAIN,
    unsent: null,
  }) as const

test("applyPlaceSteps: one rev per batch of writes and removals (ADR-0059)", () => {
  const places = newPlacesDoc()
  const [a, b] = [record(cardIdFor("c1")), record(cardIdFor("c2"))]
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
      [
        {
          kind: "write",
          record: record(cardIdFor("c1")),
        },
      ],
      gesture,
    ),
  ).toBe(1)
  // The gesture saw its record written and `rev` not yet raised.
  expect(inside).toEqual([0])
  expect(readPlaces(places)).toHaveLength(1)
})
