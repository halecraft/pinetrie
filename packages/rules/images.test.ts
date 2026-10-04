import { ERR, type ImageRef, type Sha256 } from "@pineta/core"
import { expect, test } from "vitest"
import { imageSources, pastedImages, planImages } from "./images.ts"

const A = "a".repeat(64) as Sha256
const B = "b".repeat(64) as Sha256

test("imageSources: inline, titled, angle-bracketed and reference-style, in order, each once", () => {
  const text = [
    '![one](x.png) and ![two](<with space.png> "title")',
    "![three][ref] then ![one again](x.png)",
    "",
    "[ref]: https://example.com/r.png",
  ].join("\n")
  expect(imageSources(text)).toEqual([
    "x.png",
    "with space.png",
    "https://example.com/r.png",
  ])
})

test("imageSources: an image in a link's text counts; code and a link to an image do not", () => {
  const text = [
    "[see ![inner](in.png)](https://example.com)",
    "`![inline](code.png)` and [a link](link.png)",
    "",
    "```",
    "![fenced](fenced.png)",
    "```",
    "",
    "    ![indented](indented.png)",
    "",
    "![undefined][nowhere]",
  ].join("\n")
  expect(imageSources(text)).toEqual(["in.png"])
})

test("pastedImages: only /blob/ sources, in order, each once", () => {
  const text = `![](/blob/${B}) ![](x.png) ![](/blob/${A}) ![again](/blob/${B}) ![](/blob/${"A".repeat(64)})`
  expect(pastedImages(text)).toEqual([B, A])
  expect(pastedImages("no images")).toEqual([])
})

const ref = (sha: Sha256): ImageRef => ({
  sha256: sha,
  mimeType: "image/png",
  width: 4,
  height: 3,
})

test("planImages: every image found, in the text's order", () => {
  const refs = new Map([
    [A, ref(A)],
    [B, ref(B)],
  ])
  expect(planImages([B, A], refs)).toEqual({
    kind: "images",
    images: [ref(B), ref(A)],
  })
  expect(planImages([], refs)).toEqual({ kind: "images", images: [] })
})

test("planImages: one not stored refuses the message", () => {
  const decided = planImages([A, B], new Map([[A, ref(A)]]))
  expect(decided).toMatchObject({ kind: "refused", code: ERR.IMAGE_MISSING })
  expect(decided.kind === "refused" && decided.message).toContain(
    B.slice(0, 12),
  )
})
