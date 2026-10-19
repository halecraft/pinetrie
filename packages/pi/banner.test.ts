// `set_banner` and the banner's image, through pi's harness with a scripted
// model. Co-located inside packages/pi, like lanes.test.ts: it drives pi.

import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BANNER_TOOL,
  messageText,
  ROOT,
  type Sha256,
  THE_AGENT,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type BannerAnswer,
  type BannerAsk,
  DEFAULT_ICON_MODEL,
  encodeMessage,
} from "@pinetrie/rules"
import { type RootDocHandle, readEntries, rowMessage } from "@pinetrie/schema"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { newId } from "./agent.ts"
import { bannerImageConfig, fitDrawnImage, parseBannerArgs } from "./banner.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import {
  SCRIPTED_IMAGE_PNG,
  type ScriptedModel,
  scriptedModel,
} from "./scripted.ts"
import { startPi } from "./start-pi.ts"

const SHA = "c".repeat(64) as Sha256

describe("bannerImageConfig", () => {
  test("a Recraft model is asked for a square on the black the client blends away", () => {
    expect(bannerImageConfig("recraft/recraft-v4.1-flash")).toEqual({
      aspect_ratio: "1:1",
      background_rgb_color: [0, 0, 0],
    })
  })

  test("another model is asked only for a square", () => {
    expect(bannerImageConfig("google/gemini-3.1-flash-image")).toEqual({
      aspect_ratio: "1:1",
    })
  })
})

describe("parseBannerArgs", () => {
  test("a pasted image by its path or its hash", () => {
    expect(parseBannerArgs({ image: `/blob/${SHA}` })).toEqual({
      image: SHA,
      direction: null,
    })
    expect(parseBannerArgs({ image: SHA })).toMatchObject({ image: SHA })
  })
  test("an image that names no pasted image is refused, not ignored", () => {
    expect(parseBannerArgs({ image: "https://x.io/a.png" })).toHaveProperty(
      "refused",
    )
  })
  test("blank words are none", () => {
    expect(parseBannerArgs({ image: " ", direction: "  " })).toEqual({
      image: null,
      direction: null,
    })
    expect(parseBannerArgs({ direction: " dusk " })).toMatchObject({
      direction: "dusk",
    })
  })
})

test("fitDrawnImage: a model's image is fitted as an upload is; bytes that are not one are refused", async () => {
  expect(await fitDrawnImage(SCRIPTED_IMAGE_PNG)).toMatchObject({
    kind: "drawn",
    image: { mimeType: "image/png", width: 4, height: 4 },
  })
  expect(
    await fitDrawnImage(Buffer.from("not an image at all").toString("base64")),
  ).toEqual({ kind: "failed", reason: "not an image" })
})

describe("banners in a harness", () => {
  let root = ""
  beforeAll(async () => {
    root = await realpath(
      await mkdtemp(path.join(tmpdir(), "pinetrie-banner-")),
    )
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const prompt = (text: string) =>
    encodeMessage(
      {
        author: writerId("ada"),
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: text,
      },
      Date.now(),
    )

  /**
   * pi over `doc`: with tools unless `tools` is false, each ask recorded in
   * `asks` and answered as `answer`; drawn with the default model when `draws`.
   */
  const agentOver = (
    doc: RootDocHandle,
    script: ScriptedModel,
    o: {
      readonly asks?: { lane: ThreadId; ask: BannerAsk }[]
      readonly answer?: BannerAnswer
      readonly draws?: boolean
      readonly tools?: boolean
    } = {},
  ) =>
    startPi(oneRoot(doc), {
      model: { kind: "scripted", script },
      project: root,
      tools:
        o.tools === false
          ? null
          : {
              access: () => null,
              bannerAsks: async (
                lane: ThreadId,
                ask: BannerAsk,
              ): Promise<BannerAnswer> => {
                o.asks?.push({ lane, ask })
                return o.answer ?? { kind: "requested" }
              },
              hooks: {
                turnDone: async () => {},
                askedAboutConflict: async () => false,
                configWritten: async () => null,
                getLatest: async () => {
                  throw new Error("no catch_up here")
                },
                resolveConflict: async () => {
                  throw new Error("no conflict here")
                },
                askSplit: async () => {
                  throw new Error("no split_proposed_changes here")
                },
                ask: async () => {
                  throw new Error("unused")
                },
                leave: async () => {
                  throw new Error("unused")
                },
                readCard: async () => {
                  throw new Error("read_card was not called")
                },
                putImage: async () => {
                  throw new Error("put_image was not called")
                },
                readBlob: async () => {
                  throw new Error("unused")
                },
              },
            },
      ...(o.draws === true ? { banner: DEFAULT_ICON_MODEL } : {}),
    })

  const toolResults = (doc: RootDocHandle) =>
    Object.values(readEntries(doc))
      .map(rowMessage)
      .filter(m => (m as { role?: string }).role === "toolResult")
      .map(m => messageText(m as never))

  test("the tool sends the calling thread's ask, and tells the agent the answer", async () => {
    const doc = newRootDoc()
    const script = scriptedModel()
    const asks: { lane: ThreadId; ask: BannerAsk }[] = []
    const agent = await agentOver(doc, script, { asks })
    const made = await agent.agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    script.use([
      { tool: BANNER_TOOL, args: { direction: "at dusk" } },
      { text: "done" },
    ])
    await agent.agent.lane(made.lane).run(prompt("a dusk banner, please"), [])
    expect(asks).toEqual([
      {
        lane: made.lane,
        ask: { image: null, direction: "at dusk" },
      },
    ])
    expect(toolResults(doc).join("\n")).toContain("A new banner is being made")
    await agent.close()
  })

  test("a drawing the host refuses tells the agent which setting draws", async () => {
    const doc = newRootDoc()
    const script = scriptedModel()
    const agent = await agentOver(doc, script, {
      answer: { kind: "refused", reason: "off" },
    })
    const made = await agent.agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    script.use([{ tool: BANNER_TOOL, args: {} }, { text: "done" }])
    await agent.agent.lane(made.lane).run(prompt("a banner, please"), [])
    expect(toolResults(doc).join("\n")).toContain(
      '"icons": { "source": "drawn" }',
    )
    await agent.close()
  })

  test("a lane stored with another tool list is given the current one when it is first held", async () => {
    const doc = newRootDoc()
    // An agent with no tools stores a lane that may call none.
    const before = await agentOver(doc, scriptedModel(), { tools: false })
    const made = await before.agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    await before.close()
    const script = scriptedModel()
    const asks: { lane: ThreadId; ask: BannerAsk }[] = []
    const after = await agentOver(doc, script, { asks })
    script.use([{ tool: BANNER_TOOL, args: {} }, { text: "done" }])
    await after.agent.lane(made.lane).run(prompt("a banner, please"), [])
    expect(asks.map(a => a.lane)).toEqual([made.lane])
    await after.close()
  })

  test("a scripted model draws its fixed image; with no image model, nothing", async () => {
    const on = await agentOver(newRootDoc(), scriptedModel(), { draws: true })
    expect(await on.setup.canDrawBanners()).toBe(true)
    expect(await on.setup.drawBanner("a zebra")).toMatchObject({
      kind: "drawn",
      image: { mimeType: "image/png", width: 4, height: 4 },
    })
    await on.close()
    const off = await agentOver(newRootDoc(), scriptedModel())
    expect(await off.setup.canDrawBanners()).toBe(false)
    expect(await off.setup.drawBanner("a zebra")).toMatchObject({
      kind: "failed",
    })
    await off.close()
  })
})
