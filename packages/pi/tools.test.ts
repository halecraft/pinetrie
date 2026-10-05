// Which tools a lane's runs may call, decided without a harness.

import { CATCH_UP_TOOL, CONFLICT_TOOL, SPLIT_TOOL } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { BANNER_TOOL } from "./banner.ts"
import { parseCatchUpArgs } from "./thread-tools.ts"
import { activeToolNames, toolsChanged } from "./tools.ts"

const files = ["read", "write", "edit", "bash"]

describe("activeToolNames", () => {
  test("the file tools and ask_about_conflict always; set_banner with banners", () => {
    expect(activeToolNames({ files, banners: false })).toEqual([
      ...files,
      CONFLICT_TOOL,
      CATCH_UP_TOOL,
      SPLIT_TOOL,
    ])
    expect(activeToolNames({ files, banners: true })).toEqual([
      ...files,
      CONFLICT_TOOL,
      CATCH_UP_TOOL,
      SPLIT_TOOL,
      BANNER_TOOL,
    ])
  })
})

describe("toolsChanged", () => {
  test("the same tools in another order are no change", () => {
    expect(toolsChanged(["a", "b"], ["b", "a"])).toBe(false)
  })

  test("a missing or an extra tool is a change", () => {
    expect(toolsChanged(["a", "b"], ["a"])).toBe(true)
    expect(toolsChanged(["a"], ["a", "b"])).toBe(true)
    expect(toolsChanged(["a", "b"], ["a", "c"])).toBe(true)
  })
})

describe("parseCatchUpArgs (ADR-0080)", () => {
  test("the parent only when named; the base otherwise", () => {
    expect(parseCatchUpArgs({ from: "parent" })).toBe("parent")
    expect(parseCatchUpArgs({ from: "base" })).toBe("base")
    expect(parseCatchUpArgs({})).toBe("base")
    expect(parseCatchUpArgs({ from: "elsewhere" })).toBe("base")
  })
})
