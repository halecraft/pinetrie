import { describe, expect, test } from "vitest"
import { THEMES, type Theme, themeAttribute, themeCodec } from "./theme.ts"

describe("themeCodec", () => {
  test.each(THEMES)("decodes what it encodes: %s", theme => {
    expect(themeCodec.decode(themeCodec.encode(theme))).toBe(theme)
  })
  test.each<unknown>([undefined, "sepia", 1, { theme: "light" }])(
    "decodes no theme from %s",
    raw => {
      expect(themeCodec.decode(raw)).toBeUndefined()
    },
  )
})

test.each<[Theme, string | null]>([
  ["system", null],
  ["light", "light"],
  ["dark", "dark"],
])(
  "the system's theme sets no attribute, a chosen one names itself: %s",
  (theme, attribute) => {
    expect(themeAttribute(theme)).toBe(attribute)
  },
)
