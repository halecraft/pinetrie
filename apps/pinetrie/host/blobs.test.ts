import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { type BlobStore, type Sha256, storedText } from "@pinetrie/core"
import { sha256Of } from "@pinetrie/pi"
import { describe, expect, test } from "vitest"
import {
  classifyUpload,
  MAX_UPLOAD_BYTES,
  memoryBlobs,
  planUploadHeaders,
  sqliteBlobs,
} from "./blobs.ts"
import { openDatabase } from "./store.ts"

const RED = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png",
  width: 40,
  height: 30,
} as const
/** A 1×1 red PNG. */
const RED_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  ),
)

/** A PNG of `w`×`h` grey pixels. */
function pngOf(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header.set([8, 0, 0, 0, 0], 8)
  const rows = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  )
}

/** SHA-256 of the bytes 1, 2, 3. */
const RED_SHA =
  "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" as Sha256

/** One contract, both stores: a clock the test moves. */
function blobStoreContract(
  name: string,
  make: (now: () => number) => BlobStore,
): void {
  describe(`blob store contract: ${name}`, () => {
    test("put answers the ref, keyed by the SHA-256 of the bytes", () => {
      const blobs = make(() => 1)
      expect(blobs.put(RED)).toEqual({
        sha256: RED_SHA,
        mimeType: "image/png",
        width: 40,
        height: 30,
      })
      expect(sha256Of(RED.bytes)).toBe(RED_SHA)
    })

    test("ref reads the dimensions without the bytes; get reads the bytes", () => {
      const blobs = make(() => 1)
      blobs.put(RED)
      expect(blobs.ref(RED_SHA)).toEqual({
        sha256: RED_SHA,
        mimeType: "image/png",
        width: 40,
        height: 30,
      })
      expect(blobs.ref(RED_SHA)).not.toHaveProperty("bytes")
      const got = blobs.get(RED_SHA)
      expect(got?.mimeType).toBe("image/png")
      expect([...(got?.bytes ?? [])]).toEqual([1, 2, 3])
      const other = "0".repeat(64) as Sha256
      expect(blobs.ref(other)).toBeUndefined()
      expect(blobs.get(other)).toBeUndefined()
    })

    test("a second put touches the blob and keeps the first's ref", () => {
      let now = 1
      const blobs = make(() => now)
      blobs.put(RED)
      now = 5
      expect(blobs.put({ ...RED, width: 1 }).width).toBe(40)
      expect(blobs.list()).toEqual([{ sha256: RED_SHA, touched: 5 }])
    })

    test("size reads a blob's length without its bytes", () => {
      const blobs = make(() => 1)
      blobs.put(RED)
      expect(blobs.size(RED_SHA)).toBe(3)
      expect(blobs.size("0".repeat(64) as Sha256)).toBeUndefined()
    })

    test("a put with a fitted copy keeps both, and names the copy as the blob's", () => {
      const blobs = make(() => 1)
      const fitted = { ...RED, bytes: new Uint8Array([7]), width: 4, height: 3 }
      const ref = blobs.put(RED, fitted)
      expect(ref.sha256).toBe(RED_SHA)
      expect(blobs.fitted(RED_SHA)).toEqual({
        sha256: sha256Of(fitted.bytes),
        mimeType: "image/png",
        width: 4,
        height: 3,
      })
      expect(blobs.fitted(sha256Of(fitted.bytes))).toBeUndefined()
      expect(blobs.list()).toHaveLength(2)
    })

    test("delete forgets a deleted blob's fitted copy", () => {
      const blobs = make(() => 1)
      blobs.put(RED, { ...RED, bytes: new Uint8Array([7]) })
      blobs.delete([RED_SHA])
      blobs.put(RED)
      expect(blobs.fitted(RED_SHA)).toBeUndefined()
    })

    test("delete removes exactly what it names", () => {
      const blobs = make(() => 1)
      blobs.put(RED)
      const other = blobs.put({ ...RED, bytes: new Uint8Array([9]) })
      blobs.delete([RED_SHA])
      expect(blobs.list().map(b => b.sha256)).toEqual([other.sha256])
      expect(blobs.get(RED_SHA)).toBeUndefined()
    })
  })
}

blobStoreContract("memory", now => memoryBlobs(now))
blobStoreContract("sqlite", now => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-blobs-")),
    "b.db",
  )
  return sqliteBlobs(openDatabase(file), now)
})

test("sqlite blobs outlive their connection: a reopened file serves them", () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-blobs-")),
    "b.db",
  )
  const db = openDatabase(file)
  sqliteBlobs(db).put(RED)
  db.close()
  expect(sqliteBlobs(openDatabase(file)).ref(RED_SHA)?.width).toBe(40)
})

test("markdown is kept as a blob too, with no size, and read back as itself", () => {
  for (const blobs of [memoryBlobs(), sqliteBlobs(openDatabase(":memory:"))]) {
    const ref = blobs.put(storedText("| a |\n|---|\n| 1 |"))
    expect(ref).toMatchObject({
      mimeType: "text/markdown",
      width: null,
      height: null,
    })
    expect(blobs.ref(ref.sha256)).toEqual(ref)
    const got = blobs.get(ref.sha256)
    expect(got === undefined ? null : new TextDecoder().decode(got.bytes)).toBe(
      "| a |\n|---|\n| 1 |",
    )
  }
})

test("planUploadHeaders reads a body of any type, within the limit", () => {
  const plan = (contentLength?: string) => planUploadHeaders({ contentLength })
  expect(plan("100")).toEqual({ kind: "accept" })
  expect(plan()).toEqual({ kind: "accept" })
  expect(plan(String(MAX_UPLOAD_BYTES))).toEqual({ kind: "accept" })
  expect(plan(String(MAX_UPLOAD_BYTES + 1))).toMatchObject({
    kind: "refuse",
    status: 413,
  })
  expect(plan("lots")).toMatchObject({ kind: "refuse", status: 413 })
})

describe("classifyUpload: the bytes say what an upload is", () => {
  test("an image that fits is kept as it came, with no fitted copy", async () => {
    const upload = await classifyUpload(RED_PNG)
    expect(upload.blob).toMatchObject({
      mimeType: "image/png",
      width: 1,
      height: 1,
    })
    expect([...upload.blob.bytes]).toEqual([...RED_PNG])
    expect(upload.fitted).toBeUndefined()
  })

  test("an image too large to fit is kept as it came, its fitted copy beside it", async () => {
    const wide = pngOf(2400, 10)
    const upload = await classifyUpload(wide)
    expect(upload.blob).toMatchObject({
      mimeType: "image/png",
      width: 2400,
      height: 10,
    })
    expect([...upload.blob.bytes]).toEqual([...wide])
    expect(upload.fitted).toMatchObject({ width: 2000 })
  })

  test("UTF-8 is text, kept byte for byte, a byte-order mark included", async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("é ok"),
    ])
    const upload = await classifyUpload(bytes)
    expect(upload.blob.mimeType).toBe("text/markdown")
    expect([...upload.blob.bytes]).toEqual([...bytes])
  })

  test("bytes that are neither are opaque, whatever they claim to be", async () => {
    for (const bytes of [
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1]),
      new Uint8Array([0xc3, 0x28]),
      new TextEncoder().encode("\u0000nul"),
    ])
      expect((await classifyUpload(bytes)).blob.mimeType).toBe(
        "application/octet-stream",
      )
  })
})
