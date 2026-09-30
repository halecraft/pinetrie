import { noteId, type Sha256 } from "@pineta/core"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics, putNote, record } from "./fakes.ts"
import { sweepBlobs } from "./housekeeping.ts"
import type { NoteTexts } from "./notes.ts"

// A 1×1 PNG: what the store keeps is only its bytes, type and size.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test("an image only a note's text shows is kept past its grace", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const ref = blobs.put({
    bytes: PNG,
    mimeType: "image/png",
    width: 1,
    height: 1,
  })
  const orphan = blobs.put({
    bytes: new Uint8Array([9, 9]),
    mimeType: "image/png",
    width: 1,
    height: 1,
  })
  putNote(b.doc, noteId("n-1"))
  const notes = record<Pick<NoteTexts, "hold">>({
    hold: async () => ({ text: () => `see ![x](/blob/${ref.sha256})` }),
  })
  await sweepBlobs({ basics: b, blobs, grace: 0, notes: notes.port })
  const kept: Sha256[] = blobs.list().map(x => x.sha256)
  expect(kept).toEqual([ref.sha256])
  expect(kept).not.toContain(orphan.sha256)
})
