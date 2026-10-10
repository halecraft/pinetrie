import {
  entryId,
  rootIdFor,
  type TextPlace,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
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
      id: cardIdFor(id),
      owner: ADA,
      placer: ADA,
      place,
      content: { command: null, unsent: null },
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
      kind: "pinned",
      thread: LANE,
      order: "a",
    }),
    card("away", {
      kind: "pinned",
      thread: AWAY,
      order: "a",
    }),
    card("held", { kind: "inventory", holder: ADA }),
  ])
  const provenance = createProvenance({
    basics: b,
    presence: newPresenceDoc(),
    records: { writeValues: async w => applyWrites(b, w) },
  })
  expect([...provenance.before().ends]).toEqual([[cardIdFor("here"), E1]])
})
