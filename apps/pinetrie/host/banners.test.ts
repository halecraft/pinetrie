import { type Sha256, type ThreadName, threadIdFor } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { type Drawn, type PiSetup, sha256Of } from "@pinetrie/pi"
import { readBanners } from "@pinetrie/reads"
import { type BannerAsk, NAME as NAME_RECORD, setRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { createBanners } from "./banners.ts"
import { memoryBlobs } from "./blobs.ts"
import {
  applyWrites,
  basics,
  deferred,
  methods,
  putValue,
  record,
} from "./fakes.ts"
import type { Records } from "./records.ts"

const LANE = threadIdFor("1")
const NAME = "clear-zebra" as ThreadName
const BYTES = new Uint8Array([1, 2, 3])
const SHA = sha256Of(BYTES)
const DRAWN: Drawn = {
  kind: "drawn",
  image: { bytes: BYTES, mimeType: "image/png", width: 1, height: 1 },
}

/** The setup and the scribe in one record, so the order of their calls shows. */
type FakePi = Pick<PiSetup, "canDrawBanners" | "drawBanner" | "skill"> &
  Pick<Records, "writeValues">

function setUp(pi: Partial<FakePi> = {}, named = true) {
  const b = basics()
  if (named)
    putValue(b, setRecord(NAME_RECORD, { lane: LANE, name: NAME, at: 1 }))
  const keeper = createKeeper()
  const blobs = memoryBlobs(() => 1_000)
  const fake = record<FakePi>({
    canDrawBanners: async () => true,
    skill: async () => ({
      path: "SKILL.md",
      content: "A {adjective} {noun}.",
      hash: "h",
    }),
    drawBanner: async () => DRAWN,
    writeValues: async writes => applyWrites(b, writes),
    ...pi,
  })
  const banners = createBanners({
    basics: b,
    keeper,
    blobs,
    records: fake.port,
    piSetup: fake.port,
  })
  return { b, keeper, blobs, fake, banners }
}

const ask = (a: Partial<BannerAsk>): BannerAsk => ({
  image: null,
  direction: null,
  ...a,
})

const draws = (
  calls: readonly { method: string; args: readonly unknown[] }[],
) => calls.filter(c => c.method === "drawBanner").map(c => c.args)

describe("a thread due one", () => {
  test("a thread with none gets one: the skill filled from its name, drawn, stored", async () => {
    // Drawn a timer tick later, as a real model is: `idle` must wait for it.
    const { keeper, blobs, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> => {
        await new Promise(r => setTimeout(r, 5))
        return DRAWN
      },
    })
    await banners.due(LANE)
    await keeper.idle()
    expect(methods(fake.calls)).toEqual([
      "canDrawBanners",
      "skill",
      "drawBanner",
      "writeValues",
    ])
    expect(draws(fake.calls)).toEqual([["A clear zebra."]])
    expect(blobs.ref(SHA)).toBeDefined()
    expect(readBanners(b.session).get(LANE)).toEqual({
      lane: LANE,
      sha: SHA,
      at: 1_000,
    })
  })

  test("a failed attempt is logged, and the next tries again", async () => {
    let n = 0
    const { keeper, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> =>
        ++n === 1 ? { kind: "failed", reason: "502: busy" } : DRAWN,
    })
    await banners.due(LANE)
    await keeper.idle()
    expect(draws(fake.calls)).toHaveLength(2)
    expect(b.lines.join("\n")).toContain("attempt 1: 502: busy")
    expect(readBanners(b.session).get(LANE)?.sha).toBe(SHA)
  })

  test("every attempt failing writes nothing", async () => {
    const { keeper, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> => ({ kind: "failed", reason: "x" }),
    })
    await banners.due(LANE)
    await keeper.idle()
    expect(draws(fake.calls)).toHaveLength(3)
    expect(readBanners(b.session).size).toBe(0)
  })

  test("with no key, nothing is asked of any model", async () => {
    const { keeper, fake, banners } = setUp({
      canDrawBanners: async () => false,
    })
    await banners.due(LANE)
    await keeper.idle()
    expect(methods(fake.calls)).toEqual(["canDrawBanners"])
  })

  test("with no name yet, or no skill, it is logged, and nothing is drawn", async () => {
    const { keeper, fake, banners, b } = setUp({}, false)
    await banners.due(LANE)
    await keeper.idle()
    expect(methods(fake.calls)).toEqual([])
    expect(b.lines.join("\n")).toContain("the thread has no name yet")
    const unskilled = setUp({ skill: async () => null })
    await unskilled.banners.due(LANE)
    await unskilled.keeper.idle()
    expect(draws(unskilled.fake.calls)).toEqual([])
    expect(unskilled.b.lines.join("\n")).toContain("no column-banner skill")
  })

  test("a thread with a banner, or one being made, gets no other", async () => {
    const drawing = deferred<Drawn>()
    const { keeper, fake, banners } = setUp({
      drawBanner: () => drawing.promise,
    })
    await banners.due(LANE)
    await banners.due(LANE)
    drawing.resolve(DRAWN)
    await keeper.idle()
    await banners.due(LANE)
    await keeper.idle()
    expect(draws(fake.calls)).toHaveLength(1)
  })

  test("a banner the person set meanwhile is kept", async () => {
    const drawing = deferred<Drawn>()
    const { keeper, blobs, banners, b } = setUp({
      drawBanner: () => drawing.promise,
    })
    const pasted = blobs.put({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      width: 1,
      height: 1,
    }).sha256
    await banners.due(LANE)
    expect(await banners.request(LANE, ask({ image: pasted }))).toEqual({
      kind: "set",
    })
    drawing.resolve(DRAWN)
    await keeper.idle()
    expect(readBanners(b.session).get(LANE)?.sha).toBe(pasted)
  })
})

describe("set_banner", () => {
  test("a pasted image is set; one not stored is refused", async () => {
    const { blobs, banners, b } = setUp()
    const pasted = blobs.put({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      width: 1,
      height: 1,
    }).sha256
    expect(await banners.request(LANE, ask({ image: pasted }))).toEqual({
      kind: "set",
    })
    expect(readBanners(b.session).get(LANE)?.sha).toBe(pasted)
    expect(
      await banners.request(LANE, ask({ image: "f".repeat(64) as Sha256 })),
    ).toEqual({ kind: "refused", reason: "not_stored" })
  })

  test("words are answered at once, and the banner follows", async () => {
    const { keeper, fake, banners, b } = setUp()
    expect(await banners.request(LANE, ask({ direction: "at dusk" }))).toEqual({
      kind: "requested",
    })
    await keeper.idle()
    expect(draws(fake.calls)[0]?.[0]).toBe(
      "A clear zebra.\n\nAbove all, the person asks for: at dusk",
    )
    expect(readBanners(b.session).get(LANE)?.sha).toBe(SHA)
  })
})
