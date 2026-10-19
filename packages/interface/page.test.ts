import { expect, test } from "vitest"
import { pageWords } from "./page.ts"

test("a page's words", () => {
  expect(pageWords("profile")).toEqual({ title: "Profile", back: "← back" })
})
