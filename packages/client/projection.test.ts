import { cardId } from "@pineta/core"
import { CARD_HISTORY, setRecord } from "@pineta/rules"
import {
  newLiveDoc,
  newRootDoc,
  newSessionDoc,
  physicalKey,
} from "@pineta/schema"
import { expect, test } from "vitest"
import { readSessionFacts } from "./projection.ts"

test("readSessionFacts: a write to the session keeps every fact it did not change, by identity", () => {
  const session = newSessionDoc()
  const view = { session, live: newLiveDoc(), roots: [newRootDoc()] }
  const before = readSessionFacts(view)
  const write = setRecord(CARD_HISTORY, { card: cardId("c-1"), events: [] })
  if (write.kind === "set")
    session.values.set(physicalKey(write.namespace, write.key), {
      namespace: write.namespace,
      key: write.key,
      value: write.value,
    })
  const after = readSessionFacts(view)
  const changed = Object.keys(after).filter(
    k => after[k as keyof typeof after] !== before[k as keyof typeof before],
  )
  expect(changed).toEqual(["histories"])
})
