import { describe, expect, test } from "vitest"
import {
  isDiskName,
  isFolderStateId,
  lineStateId,
  turnStateId,
} from "./index.ts"

describe("folder state ids", () => {
  test("a turn's state, a line state and a virtual base are state ids", () => {
    expect(
      isFolderStateId(turnStateId("01a14df0-0000-7000-8000-000000000001")),
    ).toBe(true)
    expect(
      isFolderStateId(lineStateId("01a14df0-0000-7000-8000-00000000000a")),
    ).toBe(true)
    expect(isFolderStateId("bases-0123abcd")).toBe(true)
  })

  test("a jj commit's id is never one", () => {
    expect(isFolderStateId("0123456789abcdef0123456789abcdef01234567")).toBe(
      false,
    )
  })

  test("an id with no dash is never one, nor one no disk can be named", () => {
    expect(isFolderStateId("base")).toBe(false)
    expect(isFolderStateId("a-b/c")).toBe(false)
    expect(isFolderStateId("line-1.tmp")).toBe(false)
  })

  test("a disk's name is one segment that never ends in .tmp", () => {
    for (const ok of ["base", "t-1", "a.b_c-d"])
      expect(isDiskName(ok)).toBe(true)
    for (const bad of ["", ".", "..", "a/b", "-a", "x.tmp"])
      expect(isDiskName(bad)).toBe(false)
  })
})
