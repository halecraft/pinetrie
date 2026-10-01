// `set_banner` and the banner's image, through pi's harness with a scripted
// model. Co-located inside packages/pi, like lanes.test.ts: it drives pi.

import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type LaneName,
  messageText,
  ROOT,
  type Sha256,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import {
  type BannerAnswer,
  type BannerAsk,
  DEFAULT_BANNER,
  encodeChat,
} from "@pineta/marginalia"
import {
  newSessionDoc,
  readEntries,
  rowMessage,
  type SessionDocHandle,
} from "@pineta/schema"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createAgent, drawnOf } from "./agent.ts"
import { BANNER_TOOL, parseBannerArgs } from "./banner.ts"
import {
  SCRIPTED_IMAGE_PNG,
  type ScriptedModel,
  scriptedModel,
} from "./scripted.ts"

const SHA = "c".repeat(64) as Sha256

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

test("drawnOf: a model's image is fitted as an upload is; bytes that are not one are refused", async () => {
  expect(await drawnOf(SCRIPTED_IMAGE_PNG)).toMatchObject({
    kind: "drawn",
    image: { mimeType: "image/png", width: 4, height: 4 },
  })
  expect(
    await drawnOf(Buffer.from("not an image at all").toString("base64")),
  ).toEqual({ kind: "failed", reason: "not an image" })
})

describe("banners in a harness", () => {
  let root = ""
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "pineta-banner-")))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const prompt = (text: string) =>
    encodeChat(
      {
        author: writerId("ada"),
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: text,
      },
      Date.now(),
    )

  /** An agent over `doc`, with banners when `asks` is given. */
  const agentOver = (
    doc: SessionDocHandle,
    script: ScriptedModel,
    asks?: { lane: LaneName; ask: BannerAsk }[],
  ) =>
    createAgent({
      doc,
      replicaId: "test",
      model: { kind: "scripted", script },
      tools: {
        project: root,
        access: () => ({ kind: "direct", dir: root, ready: Promise.resolve() }),
        hooks: { turnDone: async () => {}, askedForGuidance() {} },
      },
      ...(asks === undefined
        ? {}
        : {
            banners: {
              config: DEFAULT_BANNER,
              request: async (lane, ask): Promise<BannerAnswer> => {
                asks.push({ lane, ask })
                return { kind: "requested" }
              },
            },
          }),
    })

  const toolResults = (doc: SessionDocHandle) =>
    Object.values(readEntries(doc))
      .map(rowMessage)
      .filter(m => (m as { role?: string }).role === "toolResult")
      .map(m => messageText(m as never))

  test("the tool sends the calling thread's ask, and tells the agent the answer", async () => {
    const doc = newSessionDoc()
    const script = scriptedModel()
    const asks: { lane: LaneName; ask: BannerAsk }[] = []
    const agent = await agentOver(doc, script, asks)
    const made = await agent.createThreadLane(ROOT)
    if (made.kind !== "created") throw new Error("no lane")
    script.use([
      { tool: BANNER_TOOL, args: { direction: "at dusk" } },
      { text: "done" },
    ])
    await agent.lane(made.lane).run(prompt("a dusk banner, please"))
    expect(asks).toEqual([
      {
        lane: made.lane,
        ask: { image: null, direction: "at dusk" },
      },
    ])
    expect(toolResults(doc).join("\n")).toContain("A new banner is being made")
    await agent.close()
  })

  test("a lane stored before banners were on gets the tool at its next run's end", async () => {
    const doc = newSessionDoc()
    const before = await agentOver(doc, scriptedModel())
    const made = await before.createThreadLane(ROOT)
    if (made.kind !== "created") throw new Error("no lane")
    // A landing stores the lane's tools: then banners were off.
    await before.lane(made.lane).withGuidance(true)
    await before.lane(made.lane).withGuidance(false)
    await before.close()
    const script = scriptedModel()
    const asks: { lane: LaneName; ask: BannerAsk }[] = []
    const after = await agentOver(doc, script, asks)
    await after.lane(made.lane).withGuidance(false)
    script.use([{ tool: BANNER_TOOL, args: {} }, { text: "done" }])
    await after.lane(made.lane).run(prompt("a banner, please"))
    expect(asks.map(a => a.lane)).toEqual([made.lane])
    await after.close()
  })

  test("a lane stored while banners were on still runs once they are off, and its call says so", async () => {
    const doc = newSessionDoc()
    const before = await agentOver(doc, scriptedModel(), [])
    const made = await before.createThreadLane(ROOT)
    if (made.kind !== "created") throw new Error("no lane")
    await before.lane(made.lane).withGuidance(true)
    await before.lane(made.lane).withGuidance(false)
    await before.close()
    const script = scriptedModel()
    const after = await agentOver(doc, script)
    script.use([{ tool: BANNER_TOOL, args: {} }, { text: "no banner" }])
    const ran = await after.lane(made.lane).run(prompt("a banner, please"))
    expect(ran).toEqual({ kind: "ok" })
    expect(toolResults(doc).join("\n")).toContain("Banners are off")
    await after.close()
  })

  test("a scripted model draws its fixed image; with banners off, nothing", async () => {
    const on = await agentOver(newSessionDoc(), scriptedModel(), [])
    expect(await on.canDrawBanners()).toBe(true)
    expect(await on.drawBanner("a zebra")).toMatchObject({
      kind: "drawn",
      image: { mimeType: "image/png", width: 4, height: 4 },
    })
    await on.close()
    const off = await agentOver(newSessionDoc(), scriptedModel())
    expect(await off.canDrawBanners()).toBe(false)
    expect(await off.drawBanner("a zebra")).toMatchObject({
      kind: "failed",
    })
    await off.close()
  })
})
