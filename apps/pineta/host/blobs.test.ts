import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BlobStore, Sha256 } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  MAX_UPLOAD_BYTES,
  memoryBlobs,
  planUploadHeaders,
  route,
  sha256Of,
  sqliteBlobs,
} from "./blobs.ts"
import { openDatabase } from "./store.ts"

const RED = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png",
  width: 40,
  height: 30,
} as const
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
    mkdtempSync(path.join(tmpdir(), "pineta-blobs-")),
    "b.db",
  )
  return sqliteBlobs(openDatabase(file), now)
})

test("sqlite blobs outlive their connection: a reopened file serves them", () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-blobs-")),
    "b.db",
  )
  const db = openDatabase(file)
  sqliteBlobs(db).put(RED)
  db.close()
  expect(sqliteBlobs(openDatabase(file)).ref(RED_SHA)?.width).toBe(40)
})

test("route: a blob's GET, with its hash or null; the upload's POST; else Vite", () => {
  expect(route("GET", `/blob/${RED_SHA}`)).toEqual({
    kind: "blob-get",
    sha: RED_SHA,
  })
  expect(route("GET", "/blob/nope")).toEqual({ kind: "blob-get", sha: null })
  expect(route("POST", "/blob")).toEqual({ kind: "blob-post" })
  expect(route("GET", "/blob")).toEqual({ kind: "other" })
  expect(route("POST", `/blob/${RED_SHA}`)).toEqual({ kind: "other" })
  expect(route("GET", "/src/app.tsx")).toEqual({ kind: "other" })
})

test("planUploadHeaders reads a body only for an image type within the limit", () => {
  const plan = (contentType?: string, contentLength?: string) =>
    planUploadHeaders({ contentType, contentLength })
  expect(plan("image/png", "100")).toEqual({ kind: "accept" })
  expect(plan("image/jpeg; charset=binary")).toEqual({ kind: "accept" })
  for (const type of [
    undefined,
    "text/plain",
    "image/svg+xml",
    "multipart/form-data",
  ])
    expect(plan(type, "100")).toMatchObject({ kind: "refuse", status: 415 })
  expect(plan("image/png", String(MAX_UPLOAD_BYTES + 1))).toMatchObject({
    kind: "refuse",
    status: 413,
  })
  expect(plan("image/png", "lots")).toMatchObject({
    kind: "refuse",
    status: 413,
  })
})
