import { expect, test } from "vitest"
import { blobResponse, offerResponse, uploadRefusal } from "./responses.ts"

test("a review and a diff are immutable; a refusal is never stored", () => {
  const review = { description: "feat: x\n", files: [], widenings: [] }
  const r = offerResponse({ kind: "review", review })
  expect(r.status).toBe(200)
  expect(JSON.parse(r.body)).toEqual(review)
  expect(r.headers["content-type"]).toContain("application/json")
  expect(r.headers["cache-control"]).toContain("immutable")
  const d = offerResponse({ kind: "diff", text: "+a\n" })
  expect([d.status, d.body, d.headers["content-type"]]).toEqual([
    200,
    "+a\n",
    "text/plain; charset=utf-8",
  ])
  expect(d.headers["cache-control"]).toContain("immutable")
  const big = offerResponse({
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

test("an upload refused unread closes its connection", () => {
  expect(uploadRefusal(413, "too large", true).headers.connection).toBe("close")
  expect(uploadRefusal(415, "not an image").headers.connection).toBeUndefined()
})
