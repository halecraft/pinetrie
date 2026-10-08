import {
  atEntry,
  type CardPlace,
  cardId,
  entryId,
  PLAIN,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { newPresenceDoc } from "@pinetrie/schema"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { applyWrites, basics, ROOT_ID, threadRow } from "./fakes.ts"
import { applyPlaceSteps } from "./places.ts"
import { createProvenance } from "./provenance.ts"

test("before: a shared card's thread end in a loaded root; none for a root not loaded, or a card in an inventory", () => {
  const b = basics()
  const E1 = entryId("e-1")
  const LANE = threadIdFor("0123456789abcdef")
  writeEntry(b.root, threadRow(E1, null, LANE))
  writeLaneTip(b.root, LANE, E1)
  const ADA = writerId("ada@x.io")
  const card = (id: string, place: CardPlace) => ({
    kind: "write" as const,
    record: {
      id: cardId(id),
      owner: ADA,
      placer: ADA,
      place,
      carries: PLAIN,
      unsent: null,
    },
  })
  const elsewhere = rootIdFor("01a0ffd2-0000-7000-8000-0000000000bb")
  applyPlaceSteps(b.places, [
    card("here", {
      kind: "note",
      root: ROOT_ID,
      at: atEntry(E1),
      lane: LANE,
      cell: 0,
    }),
    card("away", {
      kind: "note",
      root: elsewhere,
      at: atEntry(E1),
      lane: LANE,
      cell: 0,
    }),
    card("held", { kind: "inventory", holder: ADA }),
  ])
  const provenance = createProvenance({
    basics: b,
    presence: newPresenceDoc(),
    records: { writeValues: async w => applyWrites(b, w) },
  })
  expect([...provenance.before().ends]).toEqual([[cardId("here"), E1]])
})
