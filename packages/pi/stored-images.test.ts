// A message's images stored as references (ADR-0051): the split, the rejoin,
// and both through `KynetaStorage`, for the entry and for pi's pending entry.

import {
  BACKGROUND_CONTEXT,
  deleteValue,
  insertEntry,
  pendingEntry,
  setValue,
} from "@earendil-works/pi-agent-core"
import type { BlobStore, ImageRef, Sha256, StoredImage } from "@pineta/core"
import { newSessionDoc } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { sha256Of } from "./images.ts"
import {
  type EntryWithoutSeq,
  fromStoredRow,
  KynetaStorage,
  toStoredRow,
} from "./storage.ts"
import { rejoinImages, splitImages } from "./stored-images.ts"

/** A 40×30 red PNG, 98 bytes. */
const RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAKUlEQVR4nO3NoQ0AAAwCMP5/ensBh2lS31wysVnFYrFYLBaLxWKxWFx5Pp2rjeB5c/4AAAAASUVORK5CYII=",
  "base64",
)
const RED_DATA = RED.toString("base64")
const RED_IMAGE: StoredImage = {
  bytes: RED,
  mimeType: "image/png",
  width: 40,
  height: 30,
}

/** A store in a map, as the host's `memoryBlobs` keeps one. */
function mapBlobs(): Pick<BlobStore, "get" | "put" | "ref"> {
  const blobs = new Map<Sha256, StoredImage>()
  const refOf = (sha256: Sha256, i: StoredImage): ImageRef => ({
    sha256,
    mimeType: i.mimeType,
    width: i.width,
    height: i.height,
  })
  return {
    put(image) {
      const sha = sha256Of(image.bytes)
      blobs.set(sha, image)
      return refOf(sha, image)
    },
    ref(sha) {
      const held = blobs.get(sha)
      return held === undefined ? undefined : refOf(sha, held)
    },
    get(sha) {
      return blobs.get(sha)
    },
  }
}

const readResult = (id: string) =>
  ({
    id,
    parentId: null,
    type: "message",
    timestamp: 1,
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: RED_DATA, mimeType: "image/png" },
      ],
      isError: false,
      timestamp: 1,
    },
  }) satisfies EntryWithoutSeq

describe("splitImages / rejoinImages", () => {
  const blobs = mapBlobs()
  const ref = blobs.put(RED_IMAGE)
  const refOf = (data: string) =>
    data === RED_DATA ? ref : (undefined as ImageRef | undefined)
  const message = readResult("e1").message

  test("a stored image becomes its reference, without its bytes", () => {
    const split = splitImages(message, refOf) as typeof message
    expect(split.content[1]).toEqual({
      type: "image",
      mimeType: "image/png",
      sha256: ref.sha256,
      width: 40,
      height: 30,
    })
    expect(JSON.stringify(split)).not.toContain(RED_DATA)
    expect(split.content[0]).toBe(message.content[0])
  })

  test("the rejoin gives back what pi wrote", () => {
    const split = splitImages(message, refOf)
    expect(rejoinImages(split, blobs.get)).toEqual(message)
  })

  test("an image the store lacks stays inline", () => {
    expect(splitImages(message, () => undefined)).toBe(message)
  })

  test("a blob no longer stored rejoins as text saying so", () => {
    const split = splitImages(message, refOf)
    expect(
      (rejoinImages(split, () => undefined) as typeof message).content[1],
    ).toEqual({
      type: "text",
      text: `[image ${ref.sha256} is no longer stored]`,
    })
  })

  test("a message without images is the same object both ways", () => {
    const text = { role: "user", content: "hi" }
    expect(splitImages(text, refOf)).toBe(text)
    expect(rejoinImages(text, blobs.get)).toBe(text)
  })

  test("a row's payload holds the reference; the rejoin restores it", () => {
    const entry = readResult("e1")
    const row = toStoredRow(entry, refOf)
    expect(JSON.stringify(row)).not.toContain(RED_DATA)
    expect(fromStoredRow(row, 4, blobs.get)).toEqual({ ...entry, seq: 4 })
  })
})

describe("KynetaStorage: a tool's image is a reference in the session", () => {
  const setUp = (blobs: Pick<BlobStore, "get" | "put" | "ref"> | undefined) => {
    const doc = newSessionDoc()
    const storage = new KynetaStorage({
      doc,
      peerId: "t",
      ...(blobs === undefined ? {} : { blobs }),
    })
    return { doc, storage }
  }
  const pending = pendingEntry("e1")
  const pendingValue = () => ({
    type: "message" as const,
    payload: readResult("e1").message,
  })

  test("neither the pending entry nor the entry stores the bytes", async () => {
    const blobs = mapBlobs()
    blobs.put(RED_IMAGE)
    const { doc, storage } = setUp(blobs)
    await storage.commit(
      [setValue(pending, pendingValue())],
      BACKGROUND_CONTEXT,
    )
    expect(JSON.stringify(doc.values())).not.toContain(RED_DATA)
    expect(
      (await storage.getValue(pending, BACKGROUND_CONTEXT))?.value,
    ).toEqual(pendingValue())

    await storage.commit(
      [insertEntry(readResult("e1")), deleteValue(pending)],
      BACKGROUND_CONTEXT,
    )
    expect(JSON.stringify(doc.entries())).not.toContain(RED_DATA)
    const [back] = await storage
      .getEntries(["e1"], BACKGROUND_CONTEXT)
      .then(m => [...m.values()])
    // The entry's timestamp is the commit's; its message is pi's.
    expect(back).toHaveProperty("message", readResult("e1").message)
  })

  test("without a store, or for an image it lacks, the bytes stay inline", async () => {
    for (const blobs of [undefined, mapBlobs()]) {
      const { doc, storage } = setUp(blobs)
      await storage.commit([insertEntry(readResult("e1"))], BACKGROUND_CONTEXT)
      expect(JSON.stringify(doc.entries())).toContain(RED_DATA)
    }
  })
})
