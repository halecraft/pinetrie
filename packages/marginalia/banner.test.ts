import {
  type BannerRecord,
  laneNameForThread,
  type Sha256,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type BannerAsk,
  bannerDue,
  bannerPrompt,
  bannerRecords,
  bannerStillWanted,
  DEFAULT_BANNER,
  decodeBannerConfig,
  decodeBannerRecord,
  encodeWorkRecord,
  planAsk,
} from "./index.ts"

const LANE = laneNameForThread("1")
const A = "a".repeat(64) as Sha256
const B = "b".repeat(64) as Sha256
const NAME = "vernal-crane" as ThreadName
const banner: BannerRecord = { lane: LANE, sha: A, at: 1 }

describe("decodeBannerConfig: banner, off unless enabled, total", () => {
  test("off", () => {
    expect(decodeBannerConfig(null)).toBeNull()
    expect(decodeBannerConfig({})).toBeNull()
    expect(decodeBannerConfig({ banner: { enabled: "yes" } })).toBeNull()
    expect(decodeBannerConfig({ banner: { model: "x/y" } })).toBeNull()
  })
  test("on, with the default model", () => {
    expect(decodeBannerConfig({ banner: { enabled: true } })).toEqual(
      DEFAULT_BANNER,
    )
  })
  test("a model is split at its first slash", () => {
    expect(
      decodeBannerConfig({
        banner: {
          enabled: true,
          model: "openrouter/google/gemini-3.1-flash-image",
        },
      }),
    ).toEqual({
      provider: "openrouter",
      model: "google/gemini-3.1-flash-image",
    })
  })
  test("a malformed model takes the default", () => {
    for (const model of ["no-slash", "/lead", "trail/", 3])
      expect(decodeBannerConfig({ banner: { enabled: true, model } })).toEqual(
        DEFAULT_BANNER,
      )
  })
})

test("bannerDue: only a thread with none, and none being made", () => {
  expect(bannerDue(undefined, false)).toBe(true)
  expect(bannerDue(banner, false)).toBe(false)
  expect(bannerDue(undefined, true)).toBe(false)
})

describe("planAsk", () => {
  const ask = (a: Partial<BannerAsk>): BannerAsk => ({
    image: null,
    direction: null,
    ...a,
  })
  const stored = (sha: Sha256) => sha === A
  test("a pasted image is used when stored", () => {
    expect(planAsk(ask({ image: A }), stored)).toEqual({
      kind: "write",
      sha: A,
    })
    expect(planAsk(ask({ image: B }), stored)).toEqual({
      kind: "refused",
      reason: "not_stored",
    })
  })
  test("words, or nothing, make a new one", () => {
    expect(planAsk(ask({ direction: "at dusk" }), stored)).toEqual({
      kind: "generate",
      direction: "at dusk",
    })
    expect(planAsk(ask({}), stored)).toEqual({
      kind: "generate",
      direction: null,
    })
  })
})

test("bannerStillWanted: a due banner gives way to one written meanwhile", () => {
  expect(bannerStillWanted(false, undefined)).toBe(true)
  expect(bannerStillWanted(false, banner)).toBe(false)
  expect(bannerStillWanted(true, banner)).toBe(true)
})

describe("bannerPrompt", () => {
  test("the template, filled from the name", () => {
    expect(
      bannerPrompt({
        template: "  A {adjective} {noun}; {noun}.  ",
        name: NAME,
        direction: null,
      }),
    ).toBe("A vernal crane; crane.")
  })
  test("the person's direction after it", () => {
    expect(
      bannerPrompt({
        template: "A {noun}.",
        name: NAME,
        direction: " at dusk ",
      }),
    ).toBe("A crane.\n\nAbove all, the person asks for: at dusk")
    expect(
      bannerPrompt({ template: "A {noun}.", name: NAME, direction: "  " }),
    ).toBe("A crane.")
  })
})

test("a banner record round-trips, keyed by lane", () => {
  const e = encodeWorkRecord({ kind: "banner", record: banner })
  expect([e.namespace, e.key]).toEqual(["pineta.banner", LANE])
  expect(decodeBannerRecord(structuredClone(e.value))).toEqual(banner)
  expect(decodeBannerRecord({ ...banner, sha: "nope" })).toBeUndefined()
  // Written when a banner had a crop: still shown.
  expect(decodeBannerRecord({ ...banner, focus: "center" })).toEqual(banner)
  expect(bannerRecords([{ value: e.value }]).get(LANE)).toEqual(banner)
})
