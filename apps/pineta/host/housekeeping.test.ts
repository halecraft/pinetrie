import type { Sha256 } from "@pineta/core"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics } from "./fakes.ts"
import { sweepBlobs } from "./housekeeping.ts"

// A 1×1 PNG: what the store keeps is only its bytes, type and size.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test("an image only a note's or a card's text shows is kept past its grace", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const put = (bytes: Uint8Array) =>
    blobs.put({ bytes, mimeType: "image/png", width: 1, height: 1 })
  const inNote = put(PNG)
  const inCard = put(new Uint8Array([7, 7]))
  const orphan = put(new Uint8Array([9, 9]))
  await sweepBlobs({
    basics: b,
    blobs,
    grace: 0,
    texts: async () => [
      {
        kind: "note",
        id: "n-1",
        text: `see ![x](/blob/${inNote.sha256})`,
        clients: [],
      },
      {
        kind: "card",
        id: "c-1",
        text: `pasted ![y](/blob/${inCard.sha256})`,
        clients: [],
      },
    ],
  })
  const kept: Sha256[] = blobs.list().map(x => x.sha256)
  expect(kept.sort()).toEqual([inNote.sha256, inCard.sha256].sort())
  expect(kept).not.toContain(orphan.sha256)
})
