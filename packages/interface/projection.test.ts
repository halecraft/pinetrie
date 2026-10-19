import { CARD_HISTORY, setRecord } from "@pinetrie/rules"
import { applyRecordWrites } from "@pinetrie/schema"
import {
  newLiveDoc,
  newRootDoc,
  newSessionDoc,
} from "@pinetrie/schema/fixtures"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import { readSessionFacts } from "./projection.ts"

test("readSessionFacts: a write to the session keeps every fact it did not change, by identity", () => {
  const session = newSessionDoc()
  const view = { session, live: newLiveDoc(), roots: [newRootDoc()] }
  const before = readSessionFacts(view)
  const write = setRecord(CARD_HISTORY, {
    card: cardIdFor("c1"),
    events: [],
  })
  applyRecordWrites(session, [write])
  const after = readSessionFacts(view)
  const changed = Object.keys(after).filter(
    k => after[k as keyof typeof after] !== before[k as keyof typeof before],
  )
  expect(changed).toEqual(["histories"])
})
