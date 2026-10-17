import { describe, expect, test } from "vitest"
import {
  type ListWidth,
  listFoldWords,
  listWidthCodec,
  otherWidth,
  shownWidth,
} from "./list-width.ts"

describe("shownWidth", () => {
  test.each<[ListWidth | undefined, boolean, ListWidth]>([
    [undefined, false, "full"],
    [undefined, true, "icons"],
    ["full", true, "full"],
    ["icons", false, "icons"],
  ])("chosen %s, small %s: %s", (chosen, small, shown) => {
    expect(shownWidth(chosen, small)).toBe(shown)
  })
})

test("otherWidth folds and unfolds", () => {
  expect(otherWidth("full")).toBe("icons")
  expect(otherWidth("icons")).toBe("full")
})

describe("listWidthCodec", () => {
  test.each<ListWidth>(["full", "icons"])("decodes what it encodes: %s", w => {
    expect(listWidthCodec.decode(listWidthCodec.encode(w))).toBe(w)
  })
  test.each<unknown>([undefined, "wide", 3, { width: "full" }])(
    "refuses %o",
    raw => {
      expect(listWidthCodec.decode(raw)).toBeUndefined()
    },
  )
})

describe("listFoldWords", () => {
  test.each<[ListWidth, string, string, string]>([
    [
      "full",
      "«",
      "fold the sidebar to icons",
      "fold the sidebar to icons (Ctrl+Shift+L)",
    ],
    [
      "icons",
      "»",
      "show the sidebar's titles",
      "show the sidebar's titles (Ctrl+Shift+L)",
    ],
  ])("%s", (shown, glyph, label, title) => {
    expect(listFoldWords(shown)).toEqual({ glyph, label, title })
  })
})
