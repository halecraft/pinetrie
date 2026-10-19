import type { Sha256 } from "@pinetrie/core"
import { expect, test } from "vitest"
import { keptImages } from "./kept-images.ts"

const SHA = "a".repeat(64) as Sha256

test("an image kept is named as its file; a refusal, or a kept file with no width, is left out", () => {
  expect(
    keptImages(
      [
        { ok: true, ref: { sha256: SHA, width: 40 } },
        { ok: false },
        { ok: true, ref: { sha256: SHA, width: null } },
      ],
      ["red.png", "big.png", "notes.txt"],
    ),
  ).toEqual({ images: [{ sha256: SHA, name: "red.png" }], left: 2 })
})

test("a file with no name is put as an image", () => {
  expect(
    keptImages([{ ok: true, ref: { sha256: SHA, width: 4 } }], []).images,
  ).toEqual([{ sha256: SHA, name: "image" }])
})
