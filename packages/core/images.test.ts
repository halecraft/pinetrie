import { describe, expect, test } from "vitest"
import {
  blobOfUrl,
  blobUrl,
  FILE_CONTENT_WINDOW,
  fileContent,
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

describe("fileContent", () => {
  const bytes = (...parts: (string | readonly number[])[]) =>
    new Uint8Array(
      parts.flatMap(p =>
        typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : [...p],
      ),
    )

  test("each image by its magic bytes", () => {
    expect(
      fileContent(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe("image/png")
    expect(fileContent(bytes([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg")
    expect(fileContent(bytes("GIF89a", [0]))).toBe("image/gif")
    expect(fileContent(bytes("GIF87a", [0]))).toBe("image/gif")
    expect(fileContent(bytes("RIFF", [1, 0, 0, 0], "WEBP"))).toBe("image/webp")
  })

  test("an SVG is text, never an image", () => {
    expect(
      fileContent(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBe("text")
  })

  test("a NUL with no image's magic is binary; empty bytes are text", () => {
    expect(fileContent(bytes("PK", [3, 4, 0]))).toBe("binary")
    expect(fileContent(new Uint8Array())).toBe("text")
  })

  test("a NUL past git's window leaves a file text", () => {
    const head = new Uint8Array(FILE_CONTENT_WINDOW + 1).fill(0x61)
    head[FILE_CONTENT_WINDOW] = 0
    expect(fileContent(head)).toBe("text")
  })
})
