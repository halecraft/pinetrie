import {
  atEntry,
  entryId,
  PLAIN,
  rootIdFor,
  type TextPlace,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { newPresenceDoc } from "@pinetrie/schema"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { applyWrites, basics, putTask, threadRow } from "./fakes.ts"
import { applyPlaceSteps } from "./places.ts"
import { createProvenance } from "./provenance.ts"

test("before: a shared card's thread end in a loaded root; none for a root not loaded, or a card in an inventory", () => {
  const b = basics()
  const E1 = entryId("e-1")
  const LANE = threadIdFor("0123456789abcdef")
  writeEntry(b.root, threadRow(E1, null, LANE))
  writeLaneTip(b.root, LANE, E1)
  const ADA = writerId("ada@x.io")
  const card = (id: string, place: TextPlace) => ({
    kind: "write" as const,
    record: {
      kind: "text" as const,
      id: textCardId(id),
      owner: ADA,
      placer: ADA,
      place,
      carries: PLAIN,
      unsent: null,
    },
  })
  // A thread's root is its record's: LANE's is loaded, AWAY's is not.
  const AWAY = threadIdFor("fedcba9876543210")
  putTask(b, LANE)
  putTask(
    b,
    AWAY,
    taskIdFor("01a0ffd2-0000-7000-8000-0000000000bc"),
    rootIdFor("01a0ffd2-0000-7000-8000-0000000000bb"),
  )
  applyPlaceSteps(b.places, [
    card("here", {
      kind: "note",
      at: atEntry(E1),
      thread: LANE,
      cell: 0,
    }),
    card("away", {
      kind: "note",
      at: atEntry(E1),
      thread: AWAY,
      cell: 0,
    }),
    card("held", { kind: "inventory", holder: ADA }),
  ])
  const provenance = createProvenance({
    basics: b,
    presence: newPresenceDoc(),
    records: { writeValues: async w => applyWrites(b, w) },
  })
  expect([...provenance.before().ends]).toEqual([[textCardId("here"), E1]])
})
