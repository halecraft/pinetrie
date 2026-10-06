import { type ImageRef, isSha256, type ToolResultView } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  CALL_MARK,
  callStatus,
  click,
  NO_MEMORY,
  type RowFacts,
  type RowSize,
  rowSize,
  toolBody,
} from "./tool-row.ts"

test.each<[RowFacts, RowSize]>([
  [{ revealed: false, shows: false, reader: null }, "closed"],
  [{ revealed: true, shows: false, reader: null }, "capped"],
  [{ revealed: false, shows: true, reader: null }, "capped"],
  [{ revealed: false, shows: false, reader: "full" }, "full"],
  [{ revealed: true, shows: false, reader: "closed" }, "closed"],
  [{ revealed: false, shows: true, reader: "closed" }, "closed"],
  [{ revealed: true, shows: false, reader: "full" }, "full"],
  [{ revealed: false, shows: true, reader: "full" }, "full"],
])("rowSize(%o) is %s", (facts, size) => {
  expect(rowSize(facts)).toBe(size)
})

test("a row never drawn before starts closed, unless its result shows an image", () => {
  expect(rowSize({ ...NO_MEMORY, shows: false })).toBe("closed")
  expect(rowSize({ ...NO_MEMORY, shows: true })).toBe("capped")
})

test.each<[RowSize, "full" | "closed"]>([
  ["closed", "full"],
  ["capped", "full"],
  ["full", "closed"],
])("a click on a %s row makes it %s", (size, next) => {
  expect(click(size)).toBe(next)
})

const sha = "a".repeat(64)
if (!isSha256(sha)) throw new Error("not a sha")
const IMAGE: ImageRef = {
  sha256: sha,
  mimeType: "image/png",
  width: 40,
  height: 30,
}
const result = (images: readonly ImageRef[]): ToolResultView => ({
  text: "Read image file [image/png]",
  isError: false,
  images,
})

test("a result with an image shows the image, its caption as the note", () => {
  expect(toolBody(result([IMAGE]))).toEqual({
    kind: "images",
    images: [IMAGE],
    note: "Read image file [image/png]",
  })
})

test("a result without an image, or no result yet, shows text", () => {
  expect(toolBody(result([]))).toEqual({ kind: "text" })
  expect(toolBody(undefined)).toEqual({ kind: "text" })
})

test("a call's status: running without a result, failed by its result's error", () => {
  const result = (isError: boolean): ToolResultView => ({
    text: "",
    isError,
    images: [],
  })
  expect(callStatus(undefined)).toBe("pending")
  expect(callStatus(result(true))).toBe("error")
  expect(callStatus(result(false))).toBe("ok")
  expect(CALL_MARK).toEqual({ pending: "…", error: "✗", ok: "✓" })
})
