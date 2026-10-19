import type { ReviewPrefs } from "@pinetrie/interface"
import { describe, expect, test } from "vitest"
import { NO_PREFS, reviewPrefsCodec } from "./review-prefs.ts"

describe("reviewPrefsCodec", () => {
  test.each<ReviewPrefs>([
    NO_PREFS,
    { wrap: true, listFolded: false },
    { wrap: false, listFolded: true },
    { wrap: true, listFolded: true },
  ])("decodes what it encodes: %o", prefs => {
    const stored = JSON.parse(JSON.stringify(reviewPrefsCodec.encode(prefs)))
    expect(reviewPrefsCodec.decode(stored)).toEqual(prefs)
  })

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["a string", "wrap"],
    ["a field missing", { wrap: true }],
    ["a field not a boolean", { wrap: "yes", listFolded: false }],
  ])("refuses %s", (_, raw) => {
    expect(reviewPrefsCodec.decode(raw)).toBeUndefined()
  })
})
