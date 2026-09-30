import { expect, test } from "vitest"
import { offerResponse } from "./reviews.ts"

test("a review and a diff are immutable; a refusal is never stored", () => {
  const review = { description: "feat: x\n", files: [] }
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
