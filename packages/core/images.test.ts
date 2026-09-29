import { expect, test } from "vitest"
import {
  blobOfUrl,
  blobUrl,
  isImageMime,
  isSha256,
  type Sha256,
} from "./images.ts"

const SHA = "a".repeat(64) as Sha256

test("blobOfUrl reads back exactly what blobUrl writes", () => {
  expect(blobUrl(SHA)).toBe(`/blob/${SHA}`)
  expect(blobOfUrl(blobUrl(SHA))).toBe(SHA)
})

test("blobOfUrl refuses a near miss", () => {
  for (const url of [
    `/blob/${"A".repeat(64)}`,
    `/blob/${"a".repeat(63)}`,
    `/blob/${SHA}/x`,
    `/blob/${SHA}?x=1`,
    `/blob/${SHA}#x`,
    `blob/${SHA}`,
    `http://host/blob/${SHA}`,
    `/blobs/${SHA}`,
  ])
    expect(blobOfUrl(url)).toBeNull()
})

test("a blob's type is one every provider takes inline", () => {
  for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"])
    expect(isImageMime(t)).toBe(true)
  for (const t of ["image/svg+xml", "image/bmp", "text/html", ""])
    expect(isImageMime(t)).toBe(false)
  expect(isSha256("0".repeat(64))).toBe(true)
  expect(isSha256("g".repeat(64))).toBe(false)
})
