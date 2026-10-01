import {
  type BannerRecord,
  entryId,
  laneNameForThread,
  type Sha256,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type BannerAsk,
  bannerRecords,
  bannerRequest,
  bannerStillWanted,
  DEFAULT_BANNER,
  decodeBannerConfig,
  decodeBannerRecord,
  encodeWorkRecord,
  FALLBACK_RATIO,
  parseFocus,
  planBanner,
  ratioFor,
  threadLines,
} from "./index.ts"

const LANE = laneNameForThread("1")
const A = "a".repeat(64) as Sha256
const B = "b".repeat(64) as Sha256
const NAME = "vernal-crane" as ThreadName
const banner: BannerRecord = { lane: LANE, sha: A, focus: "center", at: 1 }

describe("decodeBannerConfig: banner, off unless enabled, total", () => {
  test("off", () => {
    expect(decodeBannerConfig(null)).toBeNull()
    expect(decodeBannerConfig({})).toBeNull()
    expect(decodeBannerConfig({ banner: { enabled: "yes" } })).toBeNull()
    expect(decodeBannerConfig({ banner: { model: "x/y" } })).toBeNull()
  })
  test("on, with the defaults", () => {
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
          aspectRatio: "21:9",
        },
      }),
    ).toEqual({
      provider: "openrouter",
      model: "google/gemini-3.1-flash-image",
      aspectRatio: "21:9",
    })
  })
  test("a malformed model or ratio takes the default", () => {
    for (const model of ["no-slash", "/lead", "trail/", 3])
      expect(
        decodeBannerConfig({ banner: { enabled: true, model } })?.model,
      ).toBe(DEFAULT_BANNER.model)
    for (const aspectRatio of ["8x1", "0:1", "8:", 8])
      expect(
        decodeBannerConfig({ banner: { enabled: true, aspectRatio } })
          ?.aspectRatio,
      ).toBe(DEFAULT_BANNER.aspectRatio)
  })
})

test("ratioFor: the configured ratio, then the fallback", () => {
  const config = { ...DEFAULT_BANNER, aspectRatio: "4:1" }
  expect([0, 1, 2].map(n => ratioFor(n, config))).toEqual([
    "4:1",
    FALLBACK_RATIO,
    FALLBACK_RATIO,
  ])
})

describe("planBanner", () => {
  const ask = (a: Partial<BannerAsk>) =>
    ({
      kind: "asked",
      ask: { image: null, direction: null, focus: null, ...a },
    }) as const
  const plan = (
    trigger: Parameters<typeof planBanner>[0]["trigger"],
    over: Partial<Omit<Parameters<typeof planBanner>[0], "trigger">> = {},
  ) =>
    planBanner({
      trigger,
      banner: undefined,
      generating: false,
      stored: sha => sha === A,
      ...over,
    })

  test("a run's end makes one only for a thread with none, and none being made", () => {
    expect(plan({ kind: "ran" })).toEqual({
      kind: "generate",
      direction: null,
      focus: "upper",
    })
    expect(plan({ kind: "ran" }, { banner })).toEqual({ kind: "none" })
    expect(plan({ kind: "ran" }, { generating: true })).toEqual({
      kind: "none",
    })
  })
  test("a pasted image is used when stored, with its crop", () => {
    expect(plan(ask({ image: A, focus: "top" }), { banner })).toEqual({
      kind: "write",
      sha: A,
      focus: "top",
    })
    expect(plan(ask({ image: A }))).toEqual({
      kind: "write",
      sha: A,
      focus: "upper",
    })
    expect(plan(ask({ image: B }))).toEqual({
      kind: "refused",
      reason: "not_stored",
    })
  })
  test("a crop alone moves the banner there is", () => {
    expect(plan(ask({ focus: "bottom" }), { banner })).toEqual({
      kind: "write",
      sha: A,
      focus: "bottom",
    })
    expect(plan(ask({ focus: "center" }), { banner })).toEqual({
      kind: "none",
    })
    expect(plan(ask({ focus: "top" }))).toEqual({
      kind: "generate",
      direction: null,
      focus: "top",
    })
  })
  test("words, or nothing, make a new one, even while one is being made", () => {
    expect(
      plan(ask({ direction: "at dusk" }), { banner, generating: true }),
    ).toEqual({ kind: "generate", direction: "at dusk", focus: "upper" })
    expect(plan(ask({}), { banner })).toEqual({
      kind: "generate",
      direction: null,
      focus: "upper",
    })
  })
})

test("bannerStillWanted: a run's banner gives way to one written meanwhile", () => {
  expect(bannerStillWanted({ kind: "ran" }, undefined)).toBe(true)
  expect(bannerStillWanted({ kind: "ran" }, banner)).toBe(false)
  expect(
    bannerStillWanted(
      { kind: "asked", ask: { image: null, direction: null, focus: null } },
      banner,
    ),
  ).toBe(true)
})

test("parseFocus", () => {
  expect(parseFocus("top")).toBe("top")
  expect(parseFocus("left")).toBeNull()
  expect(parseFocus(undefined)).toBeNull()
})

describe("bannerRequest", () => {
  const base = {
    skill: "  Draw a banner.  ",
    name: NAME,
    direction: null,
    own: ["ana: make it fast"],
    before: ["bo: the parser"],
    budget: 1000,
  }
  test("the skill, the name, the thread, then what came before", () => {
    expect(bannerRequest(base)).toEqual({
      system: "Draw a banner.",
      user:
        'The thread is called "vernal-crane".\n\n' +
        "What this thread said:\n- ana: make it fast\n" +
        "\nWhat came before it, for context only:\n- bo: the parser\n",
    })
  })
  test("the person's direction", () => {
    expect(bannerRequest({ ...base, direction: " at dusk " }).user).toContain(
      "The person asked for: at dusk\n",
    )
  })
  test("no parent, no context section", () => {
    expect(bannerRequest({ ...base, before: [] }).user).not.toContain(
      "came before",
    )
  })
  test("the thread's own lines take the room first", () => {
    const own = Array.from({ length: 50 }, (_, i) => `ana: line ${i}`)
    const r = bannerRequest({ ...base, own, budget: 400 })
    expect(r.user).toContain("- ana: line 49\n")
    expect(r.user).toContain("earlier left out")
    expect(r.user).not.toContain("- bo: the parser")
    expect(r.user.length).toBeLessThanOrEqual(400)
  })
  test("the parent gets what is left", () => {
    const before = Array.from({ length: 50 }, (_, i) => `bo: old ${i}`)
    const r = bannerRequest({ ...base, before, budget: 400 })
    expect(r.user).toContain("- ana: make it fast\n")
    expect(r.user).toContain("- bo: old 49\n")
    expect(r.user).not.toContain("- bo: old 0\n")
  })
})

test("a banner record round-trips, keyed by lane", () => {
  const e = encodeWorkRecord({ kind: "banner", record: banner })
  expect([e.namespace, e.key]).toEqual(["pineta.banner", LANE])
  expect(decodeBannerRecord(structuredClone(e.value))).toEqual(banner)
  expect(decodeBannerRecord({ ...banner, sha: "nope" })).toBeUndefined()
  expect(decodeBannerRecord({ ...banner, focus: "left" })).toBeUndefined()
  expect(bannerRecords([{ value: e.value }]).get(LANE)).toEqual(banner)
})

describe("threadLines", () => {
  const m = (id: string, text: string) => ({
    id,
    role: "chat",
    text,
    author: "ana",
  })
  const path = [m("1", "before"), m("2", "first"), m("3", "after")]
  test("the thread's own from its first prompt, the rest before", () => {
    expect(threadLines(path, entryId("2"))).toEqual({
      own: ["ana: first", "ana: after"],
      before: ["ana: before"],
    })
  })
  test("no first prompt on the path: every line is its own", () => {
    expect(threadLines(path, null).before).toEqual([])
    expect(threadLines(path, entryId("9")).own).toHaveLength(3)
  })
})

test("bannerRequest: an unnamed thread has no name line", () => {
  expect(
    bannerRequest({
      skill: "s",
      name: null,
      direction: null,
      own: [],
      before: [],
      budget: 100,
    }).user,
  ).toBe("\nWhat this thread said:\n- (no messages)\n")
})
