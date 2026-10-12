import {
  historyScope,
  movesDocId,
  rootDocId,
  rootIdFor,
  taskIdFor,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "./messages.ts"
import {
  holdsPersonDoc,
  mayWrite,
  ownerOfPersonDoc,
  PERSON_DOC_KINDS,
  personDocId,
} from "./writers.ts"

const ADA = writerId("ada@x.io")

test.each(
  PERSON_DOC_KINDS,
)("a person's %s document names its writer, and nothing else names one", kind => {
  expect(ownerOfPersonDoc(personDocId(kind, ADA))).toEqual({
    kind,
    writer: ADA,
  })
  for (const other of [
    `${kind}:`,
    `${kind}:ada@x.io`,
    `${kind}:w-Ada@X.io`,
    "card:c-1",
    "places",
    "person:w-ada@x.io",
  ])
    expect(ownerOfPersonDoc(other)).toBeUndefined()
})

test.each(
  PERSON_DOC_KINDS,
)("a person's %s document is held by that person only", kind => {
  const doc = personDocId(kind, ADA)
  expect(holdsPersonDoc(doc, "Ada@X.io")).toBe(true)
  expect(holdsPersonDoc(doc, "bea@x.io")).toBe(false)
  expect(holdsPersonDoc("card:c-1", "ada@x.io")).toBeUndefined()
})

test("mayWrite: the host's documents are the host's; a person's is theirs, relayed by the host", () => {
  for (const doc of [
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    LIVE_DOC_ID,
    rootDocId(rootIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f09")),
    movesDocId(
      ADA,
      historyScope(taskIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f09")),
    ),
  ]) {
    expect(mayWrite(doc, HOST_PRINCIPAL)).toBe(true)
    expect(mayWrite(doc, "ada@x.io")).toBe(false)
  }
  for (const kind of PERSON_DOC_KINDS) {
    const own = personDocId(kind, ADA)
    expect(mayWrite(own, "Ada@X.io")).toBe(true)
    expect(mayWrite(own, HOST_PRINCIPAL)).toBe(true)
    expect(mayWrite(own, "bea@x.io")).toBe(false)
    expect(mayWrite(own, undefined)).toBe(false)
  }
  for (const doc of [PRESENCE_DOC_ID, "card:c-1", "undo:seat-a"])
    expect(mayWrite(doc, "ada@x.io")).toBeUndefined()
})
