import {
  cardIdOfKind,
  makeCard,
  threadIdFor,
  UNTICKED,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics, CANVAS_ID, putCanvas, seedPlaces } from "./fakes.ts"
import { createReadCard } from "./read-card.ts"

test("read_card hands the model an image's stored bytes, its words beside them", async () => {
  const b = basics()
  const ada = writerId("ada@x.io")
  const lane = threadIdFor("reader")
  putCanvas(b, lane, CANVAS_ID)
  const blobs = memoryBlobs()
  const png = new Uint8Array([137, 80, 78, 71])
  const ref = blobs.put({
    bytes: png,
    mimeType: "image/png",
    width: 4,
    height: 3,
  })
  const column = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000c1")
  const image = cardIdOfKind("image", "01a0ffd2-0000-7000-8000-0000000000c2")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: makeCard(
        "media",
        column,
        { kind: "canvas", canvas: CANVAS_ID, order: "z", width: 1 },
        UNTICKED,
        ada,
      ),
    },
    {
      kind: "write",
      record: makeCard(
        "image",
        image,
        { kind: "image", column, order: "a" },
        {
          versions: [
            {
              ...ref,
              original: ref.sha256,
              mimeType: "image/png",
              width: 4,
              height: 3,
              by: ada,
              at: 1,
            },
          ],
        },
        ada,
      ),
    },
  ])
  const read = createReadCard({
    basics: b,
    cards: { hydrate: async () => {}, textNow: () => "" },
    blobs,
  })
  const answer = await read(lane, image, null)
  expect(answer.image).toEqual({
    data: Buffer.from(png).toString("base64"),
    mimeType: "image/png",
  })
  expect(answer.text).toMatch(/version 1 of 1/)
  expect((await read(lane, "i-nope", null)).image).toBeNull()
})
