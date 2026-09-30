// e2e/images — small PNGs the suites paste and upload (ADR-0042). Each is a
// solid colour, so a real model can say which one it was shown.

import { deflateSync } from "node:zlib"

const png = (base64: string): Buffer => Buffer.from(base64, "base64")

/** 40×30, solid red. */
export const RED_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAKUlEQVR4nO3NoQ0AAAwCMP5/ensBh2lS31wysVnFYrFYLBaLxWKxWFx5Pp2rjeB5c/4AAAAASUVORK5CYII=",
)

/** 32×24, solid green. */
export const GREEN_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAI0lEQVR4nGNgWMBAWzRqwagFoxaMWjBqwagFoxaMWjA0LAAACQHgEGHDK3kAAAAASUVORK5CYII=",
)

/** 20×20, solid blue. */
export const BLUE_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAGUlEQVR4nGNgYPhPARrVPKp5VPOo5gHVDAAUwI6AVu8gqwAAAABJRU5ErkJggg==",
)

/** 24×16, solid yellow. */
export const YELLOW_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGN4doKBKog6powaNGrQqEEj2CAAG9+FH4hspA0AAAAASUVORK5CYII=",
)

/** A solid grey PNG of `w`×`h`: an image of any size, for a size a check needs. */
export function greyPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Uint8Array): Buffer => {
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
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8 // bits per sample
  header[9] = 0 // greyscale
  // Each row: filter byte 0, then its samples.
  const rows = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ])
}
