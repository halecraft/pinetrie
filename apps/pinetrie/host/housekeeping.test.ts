import {
  cardIdOfKind,
  makeCard,
  rootIdFor,
  type Sha256,
  storedText,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { readRootRecord } from "@pinetrie/reads"
import { ROOT, setRecord } from "@pinetrie/rules"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics, putValue, seedPlaces } from "./fakes.ts"
import { sweepBlobs } from "./housekeeping.ts"

// A 1×1 PNG: what the store keeps is only its bytes, type and size.
const ADA = writerId("ada@x.io")
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test("an image only a card's text shows is kept past its grace", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const put = (bytes: Uint8Array) =>
    blobs.put({ bytes, mimeType: "image/png", width: 1, height: 1 })
  const inCard = put(PNG)
  const orphan = put(new Uint8Array([9, 9]))
  await sweepBlobs({
    basics: b,
    blobs,
    grace: 0,
    texts: async () => [
      {
        id: cardIdFor("c1"),
        text: `pasted ![y](/blob/${inCard.sha256})`,
        clients: [],
      },
    ],
  })
  const kept: Sha256[] = blobs.list().map(x => x.sha256)
  expect(kept).toEqual([inCard.sha256])
  expect(kept).not.toContain(orphan.sha256)
})

test("a draft's file link keeps its file, and an image's original keeps its fitted copy", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const file = blobs.put(storedText("notes"))
  const original = blobs.put(
    { bytes: PNG, mimeType: "image/png", width: 4000, height: 10 },
    {
      bytes: new Uint8Array([7]),
      mimeType: "image/png",
      width: 2000,
      height: 5,
    },
  )
  const fitted = blobs.fitted(original.sha256)?.sha256
  await sweepBlobs({
    basics: b,
    blobs,
    grace: 0,
    texts: async () => [
      {
        id: cardIdFor("c1"),
        text: `[notes.txt](/blob/${file.sha256}) ![big](/blob/${original.sha256})`,
        clients: [],
      },
    ],
  })
  const kept = blobs.list().map(x => x.sha256)
  expect(kept).toContain(file.sha256)
  expect(kept).toContain(original.sha256)
  expect(fitted).toBeDefined()
  expect(kept).toContain(fitted)
})

test("the image sweep keeps what a root's directory record shows, though no root is loaded", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const shown = blobs.put({
    bytes: PNG,
    mimeType: "image/png",
    width: 1,
    height: 1,
  })
  putValue(
    b,
    setRecord(ROOT, {
      ...readRootRecord(rootIdFor("elsewhere"), newRootDoc()),
      blobs: [shown.sha256],
    }),
  )
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  expect(blobs.list().map(x => x.sha256)).toEqual([shown.sha256])
})

test("the blob sweep keeps a reference's quote, and deletes one no card holds", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const kept = blobs.put(storedText("| a |"))
  const dropped = blobs.put(storedText("nobody quotes this"))
  const card = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: makeCard(
        "reference",
        card,
        { kind: "inventory", holder: ADA },
        {
          address: { kind: "thread", thread: threadIdFor("a") },
          quote: kept.sha256,
        },
        ADA,
      ),
    },
  ])
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  const left = blobs.list().map(x => x.sha256)
  expect(left).toContain(kept.sha256)
  expect(left).not.toContain(dropped.sha256)
})
