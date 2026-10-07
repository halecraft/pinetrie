import { describe, expect, test } from "vitest"
import {
  hashOfPage,
  PAGE_STATE,
  pageOfHash,
  pageWords,
  planLeave,
} from "./page.ts"

describe("pageOfHash", () => {
  test.each([
    ["#profile", "profile"],
    ["", null],
    ["#", null],
    ["profile", null],
    ["#Profile", null],
    ["#profile/x", null],
    ["#constructor", null],
  ])("%j names %s", (hash, page) => {
    expect(pageOfHash(hash)).toBe(page)
  })
  test("hashOfPage is what pageOfHash reads", () => {
    expect(pageOfHash(hashOfPage("profile"))).toBe("profile")
  })
})

test("leaving goes back only over an entry this tab pushed; else it replaces the page's", () => {
  expect(planLeave(PAGE_STATE)).toBe("back")
  expect(planLeave({ ...PAGE_STATE })).toBe("back")
  expect(planLeave(null)).toBe("replace")
  expect(planLeave(undefined)).toBe("replace")
  expect(planLeave({ pinetrie: "other" })).toBe("replace")
  expect(planLeave("page")).toBe("replace")
})

test("a page's words", () => {
  expect(pageWords("profile")).toEqual({ title: "Profile", back: "← back" })
})
