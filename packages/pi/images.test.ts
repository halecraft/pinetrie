// prepareImage: the type from the bytes, the size from pi's resize.

import { deflateSync } from "node:zlib"
import { expect, test } from "vitest"
import { prepareImage } from "./images.ts"

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
    mimeType: "image/png",
    width: 40,
    height: 30,
  })
  expect(prepared.ok && Buffer.from(prepared.bytes).equals(RED)).toBe(true)
})

test("a large image is fitted to 2000 wide, its size read from the resize", async () => {
  const prepared = await prepareImage(greyPng(3000, 20))
  expect(prepared).toMatchObject({ ok: true, width: 2000 })
  expect(prepared.ok && prepared.height < 20).toBe(true)
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
