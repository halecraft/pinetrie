import {
  type BannerRecord,
  type Sha256,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  BANNER,
  type BannerAsk,
  bannerDue,
  bannerPrompt,
  bannerStillWanted,
  planAsk,
  recordsOf,
  setRecord,
} from "./index.ts"

const LANE = threadIdFor("1")
const A = "a".repeat(64) as Sha256
const B = "b".repeat(64) as Sha256
const NAME = "vernal-crane" as ThreadName
const banner: BannerRecord = { lane: LANE, sha: A, at: 1 }

test("bannerDue: only while drawing, for a thread with none, and none being made", () => {
  expect(bannerDue(undefined, false, true)).toBe(true)
  expect(bannerDue(banner, false, true)).toBe(false)
  expect(bannerDue(undefined, true, true)).toBe(false)
  expect(bannerDue(undefined, false, false)).toBe(false)
})

describe("planAsk", () => {
  const ask = (a: Partial<BannerAsk>): BannerAsk => ({
    image: null,
    direction: null,
    ...a,
  })
  const stored = (sha: Sha256) => sha === A
  test.each([true, false])(
    "a pasted image is used when stored, drawing or not (%s)",
    draws => {
      expect(planAsk(ask({ image: A }), stored, draws)).toEqual({
        kind: "write",
        sha: A,
      })
      expect(planAsk(ask({ image: B }), stored, draws)).toEqual({
        kind: "refused",
        reason: "not_stored",
      })
    },
  )
  test("words, or nothing, make a new one while drawing", () => {
    expect(planAsk(ask({ direction: "at dusk" }), stored, true)).toEqual({
      kind: "generate",
      direction: "at dusk",
    })
    expect(planAsk(ask({}), stored, true)).toEqual({
      kind: "generate",
      direction: null,
    })
  })
  test("a new one is refused while not drawing", () => {
    expect(planAsk(ask({ direction: "at dusk" }), stored, false)).toEqual({
      kind: "refused",
      reason: "off",
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
  const e = setRecord(BANNER, banner)
  expect([e.namespace, e.key]).toEqual(["pinetrie.banner", LANE])
  expect(BANNER.decode(structuredClone(e.value), LANE)).toEqual(banner)
  expect(BANNER.decode({ sha: "nope", at: 1 }, LANE)).toBeUndefined()
  // Written when a banner had a crop: still shown.
  expect(BANNER.decode({ ...banner, focus: "center" }, LANE)).toEqual(banner)
  expect(recordsOf(BANNER, [e]).get(LANE)).toEqual(banner)
})
