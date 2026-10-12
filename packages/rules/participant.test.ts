import { ERR, type ImageRef, type Sha256, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  PICTURE,
  PICTURE_MOST,
  pictureWrites,
  planPicture,
} from "./participant.ts"
import { deleteRecord, setRecord } from "./records.ts"

const ADA = writerId("ada@x.io")
const SHA = "c".repeat(64) as Sha256
const ref = (width: number, height: number): ImageRef => ({
  sha256: SHA,
  mimeType: "image/png",
  width,
  height,
})

describe("a person's picture", () => {
  test("its record holds a blob's hash, and nothing else reads as one", () => {
    expect(PICTURE.decode(SHA, ADA)).toEqual({ writer: ADA, sha256: SHA })
    for (const bad of ["C".repeat(64), "c".repeat(63), 7, null])
      expect(PICTURE.decode(bad, ADA)).toBeUndefined()
  })

  test.each([
    ["no picture", null, undefined, { kind: "clear" }],
    [
      "at the most",
      SHA,
      ref(PICTURE_MOST, PICTURE_MOST),
      { kind: "set", sha256: SHA },
    ],
    ["small", SHA, ref(40, 30), { kind: "set", sha256: SHA }],
    ["too wide", SHA, ref(PICTURE_MOST + 1, 10), { kind: "fit", sha256: SHA }],
    ["too tall", SHA, ref(10, PICTURE_MOST + 1), { kind: "fit", sha256: SHA }],
  ] as const)("%s", (_, sha, given, plan) => {
    expect(planPicture(sha, given)).toEqual(plan)
  })

  test("a blob the store does not hold is refused", () => {
    expect(planPicture(SHA, undefined)).toMatchObject({
      kind: "refuse",
      refusal: { code: ERR.IMAGE_MISSING },
    })
  })

  test("its one write sets the picture, or deletes it", () => {
    expect(pictureWrites(ADA, SHA)).toEqual(
      setRecord(PICTURE, { writer: ADA, sha256: SHA }),
    )
    expect(pictureWrites(ADA, null)).toEqual(deleteRecord(PICTURE, ADA))
  })
})
