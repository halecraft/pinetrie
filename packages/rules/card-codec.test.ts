import {
  type CardRecord,
  cardIdOfKind,
  entryId,
  makeCard,
  NO_CONTENT,
  type PlacedKind,
  type RelayDetails,
  type Sha256,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { CARD_CODEC, decodeCard, encodeCard } from "./card.ts"

const ada = writerId("ada@example.com")
const lane = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const task = taskIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
const uuid = (n: string) => `01a0ffd2-0000-7000-8000-0000000000${n}`
const queued = {
  kind: "queued",
  thread: lane,
  order: "m",
  by: ada,
  seen: "",
} as const
const relay: RelayDetails = {
  from: threadIdFor("here"),
  fromName: "sable-meadow",
  source: entryId("5"),
  asker: { kind: "agent", thread: threadIdFor("here") },
  askerName: "sable-meadow",
  text: "what next?",
  budget: entryId("1"),
  by: ada,
}

/** A card of each kind with records, its content's every column filled. */
const EACH: { readonly [K in PlacedKind]: CardRecord } = {
  text: makeCard(
    "text",
    cardIdOfKind("text", uuid("a1")),
    queued,
    {
      command: "bring-up-to-date",
      unsent: "refused",
      origin: { kind: "thread", thread: lane },
    },
    ada,
  ),
  reference: makeCard(
    "reference",
    cardIdOfKind("reference", uuid("a2")),
    { kind: "inventory", holder: ada },
    {
      address: { kind: "thread", thread: lane },
      quote: "0".repeat(64) as Sha256,
    },
    ada,
  ),
  thread: makeCard(
    "thread",
    lane,
    { kind: "canvas", task, order: "m", width: 1 },
    NO_CONTENT,
    ada,
  ),
  "note-column": makeCard(
    "note-column",
    cardIdOfKind("note-column", uuid("a3")),
    { kind: "canvas", task, order: "n", width: 1 },
    NO_CONTENT,
    ada,
  ),
  fact: makeCard(
    "fact",
    cardIdOfKind("fact", uuid("a4")),
    queued,
    { fact: { kind: "described", lane, by: ada } },
    ada,
  ),
  ask: makeCard("ask", cardIdOfKind("ask", uuid("a5")), queued, { relay }, ada),
}

const kinds = Object.keys(EACH) as PlacedKind[]

describe("a card's content as stored (CARD_CODEC, ADR-0126)", () => {
  test.each(kinds)("a %s card round-trips", kind => {
    const card = EACH[kind]
    const stored = JSON.parse(JSON.stringify(encodeCard(card)))
    expect(decodeCard(card.id, stored)).toEqual(card)
  })

  test("a row holding a column of another kind's content is refused", () => {
    for (const kind of kinds) {
      const card = EACH[kind]
      const stored = encodeCard(card)
      const own = CARD_CODEC[kind].columns
      for (const other of kinds) {
        const filled = encodeCard(EACH[other])
        for (const column of CARD_CODEC[other].columns) {
          if (own.includes(column)) continue
          expect(
            decodeCard(card.id, { ...stored, [column]: filled[column] }),
            `${kind} with ${other}'s ${column}`,
          ).toBeUndefined()
        }
      }
    }
  })
})
