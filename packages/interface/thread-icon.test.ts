import {
  type BannerRecord,
  blobUrl,
  type IconsRecord,
  type Sha256,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { builtInIconUrl, threadIcon } from "./thread-icon.ts"

const T = threadIdFor("1")
const SHA = "a".repeat(64) as Sha256
const BANNERS = new Map<typeof T, BannerRecord>([
  [T, { lane: T, sha: SHA, at: 1 }],
])
const NAMES = new Map([[T, "amber-fox" as ThreadName]])
const BUILT_IN: IconsRecord = { source: "built-in" }
const NOT_BUILT_IN: readonly [string, IconsRecord | null][] = [
  ["drawn", { source: "drawn" }],
  ["none", { source: "none" }],
  ["no record yet", null],
]

describe("threadIcon", () => {
  test.each<[string, IconsRecord | null]>([
    ["built-in", BUILT_IN],
    ...NOT_BUILT_IN,
  ])("its banner wins under %s", (_, icons) => {
    expect(
      threadIcon({ thread: T, names: NAMES, banners: BANNERS, icons }),
    ).toEqual({ kind: "banner", url: blobUrl(SHA) })
  })

  test("under built-in, a named thread with no banner shows its noun's icon", () => {
    expect(
      threadIcon({
        thread: T,
        names: NAMES,
        banners: new Map(),
        icons: BUILT_IN,
      }),
    ).toEqual({ kind: "built-in", url: builtInIconUrl("fox") })
  })

  test.each(
    NOT_BUILT_IN,
  )("under %s, a named thread with no banner shows ✦", (_, icons) => {
    expect(
      threadIcon({ thread: T, names: NAMES, banners: new Map(), icons }),
    ).toBeNull()
  })

  test("an unnamed thread, or none, shows ✦ under built-in", () => {
    const icons = BUILT_IN
    expect(
      threadIcon({ thread: T, names: new Map(), banners: new Map(), icons }),
    ).toBeNull()
    expect(
      threadIcon({ thread: null, names: NAMES, banners: BANNERS, icons }),
    ).toBeNull()
  })
})
