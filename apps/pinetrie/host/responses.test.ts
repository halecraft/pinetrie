import type { FileContent } from "@pinetrie/core"
import { expect, test } from "vitest"
import { blobResponse, reviewResponse, uploadRefusal } from "./responses.ts"

test("a review and a diff are immutable; a refusal is never stored", () => {
  const review = { description: "feat: x\n", files: [], widenings: [] }
  const r = reviewResponse({ kind: "review", review })
  expect(r.status).toBe(200)
  expect(JSON.parse(String(r.body))).toEqual(review)
  expect(r.headers["content-type"]).toContain("application/json")
  expect(r.headers["cache-control"]).toContain("immutable")
  const d = reviewResponse({ kind: "diff", text: "+a\n" })
  expect([d.status, d.body, d.headers["content-type"]]).toEqual([
    200,
    "+a\n",
    "text/plain; charset=utf-8",
  ])
  expect(d.headers["cache-control"]).toContain("immutable")
  const big = reviewResponse({
    kind: "refused",
    status: 413,
    reason: "too large to show here",
  })
  expect([big.status, big.body, big.headers["cache-control"]]).toEqual([
    413,
    "too large to show here",
    "no-store",
  ])
})

test("a blob is its bytes, typed and immutable; none is a 404", () => {
  const bytes = new Uint8Array([1, 2, 3])
  const found = blobResponse({ bytes, mimeType: "image/png" })
  expect(found.status).toBe(200)
  expect(found.body).toBe(bytes)
  expect(found.headers["content-type"]).toBe("image/png")
  expect(found.headers["content-length"]).toBe(3)
  expect(found.headers["cache-control"]).toContain("immutable")
  expect(found.headers["x-content-type-options"]).toBe("nosniff")
  expect(blobResponse(undefined).status).toBe(404)
})

test("every blob and review file is served sandboxed and unsniffed; text as plain text, opaque as a download", () => {
  const bytes = new Uint8Array([60, 104, 62])
  const text = blobResponse({ bytes, mimeType: "text/markdown" }).headers
  const opaque = blobResponse({
    bytes,
    mimeType: "application/octet-stream",
  }).headers
  const image = blobResponse({ bytes, mimeType: "image/gif" }).headers
  const file = (content: FileContent) =>
    reviewResponse({ kind: "file", content, size: 3, bytes: chunks() }).headers
  const fileImage = file("image/png")
  const fileBinary = file("binary")
  const fileText = file("text")
  for (const headers of [
    text,
    opaque,
    image,
    fileImage,
    fileBinary,
    fileText,
  ]) {
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["content-security-policy"]).toContain("sandbox")
  }
  expect(text["content-type"]).toBe("text/plain; charset=utf-8")
  expect(text["content-disposition"]).toBeUndefined()
  expect(opaque["content-type"]).toBe("application/octet-stream")
  expect(opaque["content-disposition"]).toBe("attachment")
  expect(image["content-type"]).toBe("image/gif")
  expect(fileImage["content-type"]).toBe("image/png")
  expect(fileImage["content-disposition"]).toBeUndefined()
  expect(fileImage["cache-control"]).toContain("immutable")
  // A review's text or binary file is opened as a download, never drawn.
  for (const headers of [fileBinary, fileText]) {
    expect(headers["content-type"]).toBe("application/octet-stream")
    expect(headers["content-disposition"]).toBe("attachment")
  }
})

async function* chunks(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1, 2, 3])
}

test("an upload refused unread closes its connection", () => {
  expect(uploadRefusal(413, "too large", true).headers.connection).toBe("close")
  expect(uploadRefusal(415, "not an image").headers.connection).toBeUndefined()
})
