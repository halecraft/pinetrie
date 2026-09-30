import { laneNameForThread, type Sha256 } from "@pineta/core"
import {
  type BannerAsk,
  DEFAULT_BANNER,
  encodeWorkRecord,
  FALLBACK_RATIO,
  type WorkRecord,
} from "@pineta/marginalia"
import {
  type Agent,
  type Drawn,
  type PreparedImage,
  sha256Of,
} from "@pineta/pi"
import { readBanners } from "@pineta/reads"
import { describe, expect, test } from "vitest"
import { createBanners } from "./banners.ts"
import { memoryBlobs } from "./blobs.ts"
import { basics, deferred, methods, putValue, record } from "./fakes.ts"
import { createSerial } from "./queue.ts"

const LANE = laneNameForThread("1")
const BYTES = new Uint8Array([1, 2, 3])
const SHA = sha256Of(BYTES)

type BannerAgent = Pick<
  Agent,
  "canDrawBanners" | "drawBanner" | "describe" | "skill" | "setWorkRecord"
>

const prepared = async (bytes: Uint8Array): Promise<PreparedImage> => ({
  ok: true,
  image: { bytes, mimeType: "image/png", width: 8, height: 1 },
  resized: undefined,
})

const setUp = (agent: Partial<BannerAgent> = {}) => createWith(prepared, agent)

function createWith(
  prepare: (bytes: Uint8Array) => Promise<PreparedImage>,
  agent: Partial<BannerAgent> = {},
) {
  const b = basics()
  const serial = createSerial()
  const blobs = memoryBlobs(() => 1_000)
  const fake = record<BannerAgent>({
    canDrawBanners: async () => true,
    skill: async () => ({ path: "SKILL.md", content: "Draw it.", hash: "h" }),
    describe: async () => "a dark marsh",
    drawBanner: async (): Promise<Drawn> => ({ kind: "drawn", bytes: BYTES }),
    setWorkRecord: async (r: WorkRecord) =>
      putValue(b.doc, encodeWorkRecord(r)),
    ...agent,
  })
  const banners = createBanners({
    basics: b,
    serial,
    blobs,
    config: DEFAULT_BANNER,
    agent: () => fake.port,
    prepare,
  })
  return { b, serial, blobs, fake, banners }
}

const ask = (a: Partial<BannerAsk>): BannerAsk => ({
  image: null,
  direction: null,
  focus: null,
  ...a,
})

describe("a run's end", () => {
  test("a thread with none gets one: the skill's brief, drawn at the configured ratio, stored", async () => {
    // Drawn a timer tick later, as a real model is: `idle` must wait for it.
    const { serial, blobs, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> => {
        await new Promise(r => setTimeout(r, 5))
        return { kind: "drawn", bytes: BYTES }
      },
    })
    await banners.ran(LANE)
    await serial.idle()
    expect(methods(fake.calls)).toEqual([
      "canDrawBanners",
      "skill",
      "describe",
      "drawBanner",
      "setWorkRecord",
    ])
    const describeCall = fake.calls.find(c => c.method === "describe")
    expect(describeCall?.args[0]).toMatchObject({ system: "Draw it." })
    expect(fake.calls.find(c => c.method === "drawBanner")?.args).toEqual([
      "a dark marsh",
      DEFAULT_BANNER.aspectRatio,
    ])
    expect(blobs.ref(SHA)).toBeDefined()
    expect(readBanners(b.doc).get(LANE)).toEqual({
      lane: LANE,
      sha: SHA,
      focus: "center",
      at: 1_000,
    })
  })

  test("a failed attempt is logged, and the next asks for the fallback ratio", async () => {
    let n = 0
    const { serial, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> =>
        ++n === 1
          ? { kind: "failed", reason: "400: ratio refused" }
          : { kind: "drawn", bytes: BYTES },
    })
    await banners.ran(LANE)
    await serial.idle()
    expect(
      fake.calls.filter(c => c.method === "drawBanner").map(c => c.args[1]),
    ).toEqual([DEFAULT_BANNER.aspectRatio, FALLBACK_RATIO])
    expect(b.lines.join("\n")).toContain("attempt 1: 400: ratio refused")
    expect(readBanners(b.doc).get(LANE)?.sha).toBe(SHA)
  })

  test("every attempt failing writes nothing", async () => {
    const { serial, fake, banners, b } = setUp({
      drawBanner: async (): Promise<Drawn> => ({ kind: "failed", reason: "x" }),
    })
    await banners.ran(LANE)
    await serial.idle()
    expect(fake.calls.filter(c => c.method === "drawBanner")).toHaveLength(3)
    expect(readBanners(b.doc).size).toBe(0)
  })

  test("an image the upload's check refuses is not stored", async () => {
    const { serial, blobs, banners, b } = createWith(async () => ({
      ok: false,
      reason: "not an image",
    }))
    await banners.ran(LANE)
    await serial.idle()
    expect(blobs.list()).toEqual([])
    expect(readBanners(b.doc).size).toBe(0)
    expect(b.lines.join("\n")).toContain("attempt 3: not an image")
  })

  test("with no key, nothing is asked of any model", async () => {
    const { serial, fake, banners } = setUp({
      canDrawBanners: async () => false,
    })
    await banners.ran(LANE)
    await serial.idle()
    expect(methods(fake.calls)).toEqual(["canDrawBanners"])
  })

  test("a thread with a banner, or one being made, gets no other", async () => {
    const drawing = deferred<Drawn>()
    const { serial, fake, banners } = setUp({
      drawBanner: () => drawing.promise,
    })
    await banners.ran(LANE)
    await banners.ran(LANE)
    drawing.resolve({ kind: "drawn", bytes: BYTES })
    await serial.idle()
    await banners.ran(LANE)
    await serial.idle()
    expect(fake.calls.filter(c => c.method === "describe")).toHaveLength(1)
  })

  test("a banner the person set meanwhile is kept", async () => {
    const drawing = deferred<Drawn>()
    const { serial, blobs, banners, b } = setUp({
      drawBanner: () => drawing.promise,
    })
    const pasted = blobs.put({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      width: 1,
      height: 1,
    }).sha256
    await banners.ran(LANE)
    expect(await banners.request(LANE, ask({ image: pasted }))).toEqual({
      kind: "set",
    })
    drawing.resolve({ kind: "drawn", bytes: BYTES })
    await serial.idle()
    expect(readBanners(b.doc).get(LANE)?.sha).toBe(pasted)
  })
})

describe("set_banner", () => {
  test("a pasted image is set with its crop; one not stored is refused", async () => {
    const { blobs, banners, b } = setUp()
    const pasted = blobs.put({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      width: 1,
      height: 1,
    }).sha256
    expect(
      await banners.request(LANE, ask({ image: pasted, focus: "top" })),
    ).toEqual({ kind: "set" })
    expect(readBanners(b.doc).get(LANE)).toMatchObject({
      sha: pasted,
      focus: "top",
    })
    expect(
      await banners.request(LANE, ask({ image: "f".repeat(64) as Sha256 })),
    ).toEqual({ kind: "refused", reason: "not_stored" })
  })

  test("words are answered at once, and the banner follows", async () => {
    const { serial, fake, banners, b } = setUp()
    expect(await banners.request(LANE, ask({ direction: "at dusk" }))).toEqual({
      kind: "requested",
    })
    await serial.idle()
    expect(
      (
        fake.calls.find(c => c.method === "describe")?.args[0] as {
          user: string
        }
      ).user,
    ).toContain("The person asked for: at dusk")
    expect(readBanners(b.doc).get(LANE)?.sha).toBe(SHA)
  })
})
