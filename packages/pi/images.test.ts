// prepareImage: the type from the bytes, the size from pi's resize; and
// `read`'s processor, which stores what it returns.

import { createHash } from "node:crypto"
import { deflateSync } from "node:zlib"
import {
  type ImageRef,
  laneNameForThread,
  ROOT,
  type Sha256,
  type StoredImage,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { encodeChat } from "@pineta/rules"
import { newRootDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { createAgent, newId } from "./agent.ts"
import { prepareImage, readImageProcessor, sha256Of } from "./images.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { scriptedModel } from "./scripted.ts"

/** A 40×30 red PNG, 98 bytes. */
const RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAKUlEQVR4nO3NoQ0AAAwCMP5/ensBh2lS31wysVnFYrFYLBaLxWKxWFx5Pp2rjeB5c/4AAAAASUVORK5CYII=",
  "base64",
)

/** A grey PNG of `w`×`h`, from raw rows: big enough to be resized. */
function greyPng(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, "ascii")
    Buffer.from(data).copy(out, 8)
    let crc = 0xffffffff
    for (const b of out.subarray(4, 8 + data.length)) {
      let c = (crc ^ b) & 0xff
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crc = (crc >>> 8) ^ c
    }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  const raw = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}

test("a small PNG is kept as it is, with its size", async () => {
  const prepared = await prepareImage(RED)
  expect(prepared).toMatchObject({
    ok: true,
    image: { mimeType: "image/png", width: 40, height: 30 },
    resized: undefined,
  })
  expect(prepared.ok && Buffer.from(prepared.image.bytes).equals(RED)).toBe(
    true,
  )
})

test("a large image is fitted to 2000 wide, its size read from the resize", async () => {
  const prepared = await prepareImage(greyPng(3000, 20))
  expect(prepared).toMatchObject({ ok: true, image: { width: 2000 } })
  expect(prepared.ok && prepared.image.height < 20).toBe(true)
  expect(prepared.ok && prepared.resized).toMatch(
    /^\[Image: original 3000x20, displayed at 2000x\d+\./,
  )
})

test("SVG, BMP and text are not images; a truncated PNG is unreadable", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
  // A 24-bit BMP pi recognizes, which no provider takes inline. Wider than
  // 2000, so a resize would turn it into a PNG or JPEG if it were let through.
  const [w, h] = [2100, 2]
  const row = Math.ceil((w * 3) / 4) * 4
  const bmp = Buffer.alloc(54 + row * h, 0x80)
  bmp.write("BM", 0)
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(0, 6)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(w, 18)
  bmp.writeInt32LE(h, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(0, 30)
  bmp.writeUInt32LE(row * h, 34)
  for (const bytes of [svg, bmp, Buffer.from("hello"), new Uint8Array()])
    expect(await prepareImage(bytes)).toEqual({
      ok: false,
      reason: "not an image",
    })
  expect(await prepareImage(RED.subarray(0, 40))).toEqual({
    ok: false,
    reason: "unreadable",
  })
})

test("the model reads a chat's text, then its image's bytes, from the store", async () => {
  const doc = newRootDoc()
  const script = scriptedModel()
  const sha = createHash("sha256").update(RED).digest("hex") as Sha256
  const agent = await createAgent({
    documents: oneRoot(doc),
    replicaId: "test",
    model: { kind: "scripted", script },
    tools: null,
    blobs: {
      get: s => (s === sha ? { bytes: RED, mimeType: "image/png" } : undefined),
      ref: () => undefined,
      put: () => {
        throw new Error("no image is read here")
      },
    },
  })
  let seen: readonly string[] = []
  script.use([
    {
      reply: context => {
        seen = context
        return "a red one"
      },
    },
  ])
  const made = await agent.createThreadLane(
    { root: ONE_ROOT, at: ROOT },
    laneNameForThread(newId()),
  )
  if (made.kind !== "created") throw new Error("no lane")
  const text = `what colour? ![red](/blob/${sha})`
  await agent.lane(made.lane).run(
    encodeChat(
      {
        author: writerId("ada@example.com"),
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: "s-1",
        images: [{ sha256: sha, mimeType: "image/png", width: 1, height: 1 }],
      },
      1,
    ),
    [],
  )
  await agent.close()
  expect(seen.at(-1)).toBe(`Ada: ${text}[image image/png ${sha}]`)
})

/** A store that records what a processor put in it. */
function recording() {
  const put: StoredImage[] = []
  return {
    put,
    blobs: {
      put(image: StoredImage): ImageRef {
        put.push(image)
        return {
          sha256: sha256Of(image.bytes),
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
        }
      },
    },
  }
}

// The processor reads nothing from pi's context.
const CONTEXT = {} as never
const OPTIONS = { autoResizeImages: true }

test("read's processor stores the image it returns", async () => {
  for (const bytes of [RED, greyPng(3000, 20)]) {
    const { put, blobs } = recording()
    const result = await readImageProcessor(blobs)(
      bytes,
      "image/png",
      OPTIONS,
      CONTEXT,
    )
    if (!result.ok) throw new Error(result.message)
    expect(put).toHaveLength(1)
    expect(put[0]?.mimeType).toBe(result.mimeType)
    expect(sha256Of(Buffer.from(result.data, "base64"))).toBe(
      sha256Of(put[0]?.bytes ?? new Uint8Array()),
    )
  }
})

test("read's processor tells the model of a resize, and only then", async () => {
  const { blobs } = recording()
  const hints = async (bytes: Uint8Array) => {
    const result = await readImageProcessor(blobs)(
      bytes,
      "image/png",
      OPTIONS,
      CONTEXT,
    )
    return result.ok ? result.hints : undefined
  }
  expect(await hints(RED)).toEqual([])
  expect(await hints(greyPng(3000, 20))).toEqual([
    expect.stringMatching(/^\[Image: original 3000x20, displayed at 2000x/),
  ])
})

test("read's processor omits what it cannot keep, and stores nothing", async () => {
  const { put, blobs } = recording()
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
  for (const [bytes, message] of [
    [svg, "[Image omitted: not an image this harness keeps.]"],
    [RED.subarray(0, 40), "[Image omitted: could not be read or fitted.]"],
  ] as const)
    expect(
      await readImageProcessor(blobs)(bytes, "image/png", OPTIONS, CONTEXT),
    ).toEqual({ ok: false, message })
  expect(put).toEqual([])
})
