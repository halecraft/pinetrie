import {
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  makeCard,
  NO_CONTENT,
  type PlacedKind,
  type RelayDetails,
  type Sha256,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { CARD_CODEC, decodeCard, encodeCard } from "./card.ts"

const ada = writerId("ada@example.com")
const lane = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const canvas = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
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
  allowance: entryId("1"),
  by: ada,
}

/** A card of each kind with records, its content's every column filled. */
const EACH: { readonly [K in PlacedKind]: CardRecord } = {
  text: makeCard(
    "text",
    cardIdOfKind("text", uuid("a1")),
    queued,
    {
      command: "get-latest",
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
    { kind: "canvas", canvas, order: "m", width: 1 },
    { ticked: true },
    ada,
  ),
  canvas: makeCard(
    "canvas",
    canvas,
    { kind: "board", state: workflowStateIdFor("todo"), order: "m" },
    NO_CONTENT,
    ada,
  ),
  "note-column": makeCard(
    "note-column",
    cardIdOfKind("note-column", uuid("a3")),
    { kind: "canvas", canvas, order: "n", width: 1 },
    { ticked: true },
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
  media: makeCard(
    "media",
    cardIdOfKind("media", uuid("a6")),
    { kind: "inventory", holder: ada },
    { ticked: true },
    ada,
  ),
  image: makeCard(
    "image",
    cardIdOfKind("image", uuid("a7")),
    { kind: "image", column: cardIdOfKind("media", uuid("a6")), order: "m" },
    {
      versions: [
        {
          sha256: "1".repeat(64) as Sha256,
          original: "1".repeat(64) as Sha256,
          mimeType: "image/png",
          width: 4,
          height: 3,
          by: ada,
          at: 1,
        },
        {
          sha256: "2".repeat(64) as Sha256,
          original: "2".repeat(64) as Sha256,
          mimeType: "image/png",
          width: 4,
          height: 3,
          by: ada,
          at: 2,
        },
      ],
    },
    ada,
  ),
}

const kinds = Object.keys(EACH) as PlacedKind[]

describe("a card's content as stored (CARD_CODEC)", () => {
  test.each(kinds)("a %s card round-trips", kind => {
    const card = EACH[kind]
    const stored = JSON.parse(JSON.stringify(encodeCard(card)))
    expect(decodeCard(card.id, stored)).toEqual(card)
  })

  test("a column's row stored before ticks decodes unticked", () => {
    for (const kind of ["thread", "note-column", "media"] as const) {
      const { ticked: _, ...before } = encodeCard(EACH[kind])
      expect(decodeCard(EACH[kind].id, before)?.content).toEqual({
        ticked: false,
      })
    }
  })

  test("a tick that is neither 1 nor empty is refused", () => {
    expect(
      decodeCard(EACH.thread.id, { ...encodeCard(EACH.thread), ticked: "yes" }),
    ).toBeUndefined()
  })

  test("an image with no versions, or one that is no blob's, is refused", () => {
    const stored = encodeCard(EACH.image)
    expect(
      decodeCard(EACH.image.id, { ...stored, versions: "[]" }),
    ).toBeUndefined()
    expect(
      decodeCard(EACH.image.id, {
        ...stored,
        versions: JSON.stringify([
          {
            sha256: "x",
            original: "x",
            mimeType: "image/png",
            width: 4,
            height: 3,
            by: ada,
            at: 1,
          },
        ]),
      }),
    ).toBeUndefined()
    expect(
      decodeCard(EACH.image.id, { ...stored, versions: "{" }),
    ).toBeUndefined()
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
