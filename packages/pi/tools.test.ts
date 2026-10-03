// Which tools a lane's runs may call, decided without a harness.

import { describe, expect, test } from "vitest"
import { BANNER_TOOL } from "./banner.ts"
import { GUIDANCE_TOOL } from "./lanes.ts"
import { activeToolNames, toolsChanged } from "./tools.ts"

const files = ["read", "write", "edit", "bash"]

describe("activeToolNames", () => {
  test("the file tools always; set_banner with banners; guidance when asked", () => {
    expect(activeToolNames({ files, banners: false, guidance: false })).toEqual(
      files,
    )
    expect(activeToolNames({ files, banners: true, guidance: false })).toEqual([
      ...files,
      BANNER_TOOL,
    ])
    expect(activeToolNames({ files, banners: true, guidance: true })).toEqual([
      ...files,
      BANNER_TOOL,
      GUIDANCE_TOOL,
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
