import { expect, test } from "vitest"
import { parseSize } from "./size.ts"

const GiB = 1024 ** 3
const MiB = 1024 ** 2

test("a unit alone, with iB, and in any case read alike, binary", () => {
  expect(parseSize("4G")).toBe(4 * GiB)
  expect(parseSize("4GiB")).toBe(4 * GiB)
  expect(parseSize("4g")).toBe(4 * GiB)
  expect(parseSize("4 gib")).toBe(4 * GiB)
  expect(parseSize("1.5T")).toBe(1.5 * 1024 * GiB)
  expect(parseSize("8k")).toBe(8 * 1024)
})

test("the limits the repo's containers are made with read as Docker reads them", () => {
  expect(parseSize("4G")).toBe(4 * GiB)
  expect(parseSize("256m")).toBe(256 * MiB)
  expect(parseSize("512M")).toBe(512 * MiB)
})

test("a bare number is bytes, and only a whole one", () => {
  expect(parseSize("4096")).toBe(4096)
  expect(parseSize("0")).toBe(0)
  expect(parseSize("1.5")).toBeNull()
})

test("a unit with a bare B is refused, since people read it as decimal", () => {
  expect(parseSize("4GB")).toBeNull()
  expect(parseSize("4gb")).toBeNull()
  expect(parseSize("50 GB")).toBeNull()
  expect(parseSize("4B")).toBeNull()
})

test("what is no size is refused", () => {
  for (const text of ["", "lots", "G", "-4G", "4X", "4 G B", "4iB"])
    expect(parseSize(text)).toBeNull()
})
