// Which tools a lane's runs may call, decided without a harness.

import { BANNER_TOOL, TOOL_IDS } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { parseCatchUpArgs } from "./thread-tools.ts"
import { activeToolNames, assembleTools, TOOLS, toolsChanged } from "./tools.ts"

const unused = async (): Promise<never> => {
  throw new Error("not called")
}
const input = {
  hooks: {
    turnDone: unused,
    askedAboutConflict: unused,
    catchUp: unused,
    askSplit: unused,
  },
  blobs: undefined,
  bannerAsks: undefined,
}

describe("TOOLS (ADR-0114)", () => {
  test.each(TOOL_IDS)("%s is the name of the tool made for it", id => {
    expect(TOOLS[id](input).name).toBe(id)
  })

  test("every tool is registered, in the order the model is given them", () => {
    expect(
      assembleTools(input).registered.map(t => (t as { name: string }).name),
    ).toEqual([...TOOL_IDS])
  })
})

describe("activeToolNames", () => {
  // The order is every request's prefix (S85): pinned, not derived.
  const always = [
    "read",
    "write",
    "edit",
    "bash",
    "grep",
    "find",
    "ask_about_conflict",
    "catch_up",
    "split_offer",
  ]
  test("every tool always; set_banner with banners", () => {
    expect(activeToolNames({ banners: false })).toEqual(always)
    expect(activeToolNames({ banners: true })).toEqual([...always, BANNER_TOOL])
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
