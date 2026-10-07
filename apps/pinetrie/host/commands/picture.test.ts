import {
  ERR,
  type ImageRef,
  type Sha256,
  type StoredImage,
  writerId,
} from "@pinetrie/core"
import { PICTURE_MOST, pictureWrites } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { methods, record, writesOf } from "../fakes.ts"
import { handlePicture, type PictureDeps } from "./picture.ts"

const ADA = writerId("ada@example.com")
const BIG = "a".repeat(64) as Sha256
const SMALL = "b".repeat(64) as Sha256
const FITTED = "f".repeat(64) as Sha256
const BYTES = new Uint8Array([1, 2, 3])

const refOf = (sha256: Sha256, side: number): ImageRef => ({
  sha256,
  mimeType: "image/png",
  width: side,
  height: side,
})

/** A store holding a small picture and a big one, and a fit that works or not. */
function deps(fits: boolean) {
  const stored = new Map([
    [SMALL, refOf(SMALL, 256)],
    [BIG, refOf(BIG, PICTURE_MOST * 2)],
  ])
  const blobs = record<PictureDeps["blobs"]>({
    ref: sha => stored.get(sha),
    get: sha =>
      stored.has(sha) ? { bytes: BYTES, mimeType: "image/png" } : undefined,
    put: (image: StoredImage) => ({ ...refOf(FITTED, image.width) }),
  })
  const records = record<PictureDeps["records"]>({
    writeValues: async () => {},
  })
  const fitted: { bytes: Uint8Array; most: number }[] = []
  const port: PictureDeps = {
    blobs: blobs.port,
    records: records.port,
    fitImage: async (bytes, most) => {
      fitted.push({ bytes, most })
      return fits
        ? {
            bytes: new Uint8Array([9]),
            mimeType: "image/png",
            width: most,
            height: most,
          }
        : null
    },
  }
  return { port, blobs, records, fits: fitted }
}

test("a stored picture is set for its sender, and null removes it", async () => {
  const d = deps(true)
  expect(
    await handlePicture(d.port, ADA, { kind: "picture", sha256: SMALL }),
  ).toEqual({ kind: "pictured" })
  expect(
    await handlePicture(d.port, ADA, { kind: "picture", sha256: null }),
  ).toEqual({ kind: "pictured" })
  expect(writesOf(d.records.calls)).toEqual([
    pictureWrites(ADA, SMALL),
    pictureWrites(ADA, null),
  ])
  expect(d.fits).toEqual([])
})

test("a picture the store does not hold is refused, and nothing is written", async () => {
  const d = deps(true)
  const missing = "e".repeat(64) as Sha256
  expect(
    await handlePicture(d.port, ADA, { kind: "picture", sha256: missing }),
  ).toMatchObject({ kind: "refused", code: ERR.IMAGE_MISSING })
  expect(d.records.calls).toEqual([])
})

test("an oversized picture is fitted within PICTURE_MOST, kept, and its copy set, not the original", async () => {
  const d = deps(true)
  expect(
    await handlePicture(d.port, ADA, { kind: "picture", sha256: BIG }),
  ).toEqual({ kind: "pictured" })
  expect(d.fits).toEqual([{ bytes: BYTES, most: PICTURE_MOST }])
  expect(methods(d.blobs.calls)).toEqual(["ref", "get", "put"])
  expect(writesOf(d.records.calls)).toEqual([pictureWrites(ADA, FITTED)])
})

test("a picture pi cannot fit is refused, and nothing is written", async () => {
  const d = deps(false)
  expect(
    await handlePicture(d.port, ADA, { kind: "picture", sha256: BIG }),
  ).toMatchObject({ kind: "refused", code: ERR.PICTURE_UNREADABLE })
  expect(methods(d.blobs.calls)).toEqual(["ref", "get"])
  expect(d.records.calls).toEqual([])
})
