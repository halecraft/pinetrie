import {
  type BlobRef,
  ERR,
  type ImageRef,
  type Sha256,
  type Share,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  fenceFor,
  fittedLine,
  hasLocation,
  isUtf8Text,
  planSaveBlob,
  planShares,
  readableBlobs,
  type StoredShare,
  shareMarkdown,
  shareQuote,
  shareQuoteMarkdown,
  textBlobs,
} from "./shares.ts"

const A = "a".repeat(64) as Sha256
const B = "b".repeat(64) as Sha256
const C = "c".repeat(64) as Sha256

const image = (sha: Sha256, width = 4, height = 3): ImageRef => ({
  sha256: sha,
  mimeType: "image/png",
  width,
  height,
})
const text = (sha: Sha256): BlobRef => ({
  sha256: sha,
  mimeType: "text/markdown",
  width: null,
  height: null,
})
const opaque = (sha: Sha256): BlobRef => ({
  sha256: sha,
  mimeType: "application/octet-stream",
  width: null,
  height: null,
})

describe("isUtf8Text", () => {
  test("UTF-8 with no NUL is text, a byte-order mark included", () => {
    expect(isUtf8Text(new TextEncoder().encode("é\nok"))).toBe(true)
    expect(isUtf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe(true)
    expect(isUtf8Text(new Uint8Array([]))).toBe(true)
  })

  test("a NUL, or a sequence that is not UTF-8, is not text", () => {
    expect(isUtf8Text(new Uint8Array([0x61, 0, 0x62]))).toBe(false)
    expect(isUtf8Text(new Uint8Array([0xc3, 0x28]))).toBe(false)
    expect(isUtf8Text(new Uint8Array([0xe2, 0x82]))).toBe(false)
  })
})

/** A big-endian TIFF whose IFD0 points at a GPS IFD holding `gpsTags`. */
function tiff(gpsTags: readonly number[]): number[] {
  const out = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]
  // IFD0 at 8: one entry, GPS pointer (0x8825, LONG) at offset 26.
  out.push(0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0)
  out.push(0, gpsTags.length)
  for (const tag of gpsTags)
    out.push(tag >> 8, tag & 0xff, 0, 5, 0, 0, 0, 3, 0, 0, 0, 0)
  out.push(0, 0, 0, 0)
  return out
}

describe("hasLocation", () => {
  test("EXIF's GPS latitude, wherever the TIFF sits in the file", () => {
    const jpegLike = [0xff, 0xd8, 0xff, 0xe1, 0, 30, ...tiff([0, 1, 2, 3])]
    expect(hasLocation(new Uint8Array(jpegLike))).toBe(true)
    expect(hasLocation(new Uint8Array([9, 9, 9, ...tiff([2])]))).toBe(true)
  })

  test("a GPS block with only its version places no one", () => {
    expect(hasLocation(new Uint8Array(tiff([0])))).toBe(false)
  })

  test("XMP's latitude counts too", () => {
    const xmp = '<rdf:Description exif:GPSLatitude="48,51.5N"/>'
    expect(hasLocation(new TextEncoder().encode(xmp))).toBe(true)
  })

  test("no EXIF or XMP, or a TIFF header with nothing behind it, is none", () => {
    expect(hasLocation(new TextEncoder().encode("plain text"))).toBe(false)
    expect(hasLocation(new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0xff]))).toBe(false)
    expect(hasLocation(new Uint8Array([]))).toBe(false)
  })
})

describe("textBlobs", () => {
  test("images and links to /blob/, with their names, in order, each once", () => {
    const md = [
      `![red](/blob/${A}) and [notes.txt](/blob/${B})`,
      `![again](/blob/${A}) [elsewhere](https://example.com) ![x](x.png)`,
      `[ref one][r] ![ref two][s]`,
      "",
      `[r]: /blob/${C}`,
      `[s]: /blob/${B}`,
    ].join("\n")
    expect(textBlobs(md)).toEqual([
      { sha256: A, name: "red", image: true },
      { sha256: B, name: "notes.txt", image: false },
      { sha256: C, name: "ref one", image: false },
    ])
  })

  test("a link in code is text, and a hash in the wrong case names nothing", () => {
    const md = [
      `\`[code](/blob/${A})\``,
      "```",
      `![fenced](/blob/${B})`,
      "```",
      `![upper](/blob/${"A".repeat(64)})`,
    ].join("\n")
    expect(textBlobs(md)).toEqual([])
  })

  test("reads back every link shareMarkdown writes, for any name", () => {
    const names = [
      "red.png",
      "",
      "   ",
      "a [bracketed] name",
      "back\\slash\\",
      "paren (1).txt",
      "two\nlines",
      "]![",
      "*emphasis* _too_",
      "`ticks`",
    ]
    for (const name of names)
      for (const ref of [image(A), text(A), opaque(A)]) {
        const [read] = textBlobs(`see ${shareMarkdown(name, ref)} here`)
        const fallback = ref.mimeType === "image/png" ? "image" : "file"
        const expected =
          name.trim() === "" ? fallback : name.replace(/\s+/g, " ").trim()
        expect(read?.sha256).toBe(A)
        expect(read?.image).toBe(ref.mimeType === "image/png")
        if (!/[*_`]/.test(name)) expect(read?.name).toBe(expected)
      }
  })
})

const stored = (
  ref: BlobRef,
  extra: Partial<StoredShare> = {},
): StoredShare => ({
  ref,
  size: 10,
  fitted: undefined,
  hasLocation: false,
  ...extra,
})

describe("planShares", () => {
  test("every named blob is a share; images' shown copies are the model's parts, in order", () => {
    const fitted = image(C, 2000, 1000)
    const decided = planShares(
      textBlobs(`[n.txt](/blob/${B}) ![big](/blob/${A}) ![small](/blob/${C})`),
      new Map([
        [A, stored(image(A, 4000, 2000), { fitted, hasLocation: true })],
        [B, stored(text(B), { size: 5 })],
        [C, stored(image(C))],
      ]),
    )
    expect(decided).toEqual({
      kind: "shares",
      images: [fitted, image(C)],
      shared: [
        {
          name: "n.txt",
          original: text(B),
          size: 5,
          shown: null,
          hasLocation: false,
        },
        {
          name: "big",
          original: image(A, 4000, 2000),
          size: 10,
          shown: fitted,
          hasLocation: true,
        },
        {
          name: "small",
          original: image(C),
          size: 10,
          shown: image(C),
          hasLocation: false,
        },
      ],
    })
  })

  test("one not stored refuses the message", () => {
    const decided = planShares(
      textBlobs(`![a](/blob/${A}) [b](/blob/${B})`),
      new Map([[A, stored(image(A))]]),
    )
    expect(decided).toMatchObject({ kind: "refused", code: ERR.IMAGE_MISSING })
    expect(decided.kind === "refused" && decided.message).toContain(
      B.slice(0, 12),
    )
  })
})

const share = (
  original: BlobRef,
  size: number,
  shown: ImageRef | null = null,
): Share => ({
  name: "f",
  original,
  size,
  shown,
  hasLocation: false,
})

describe("a share's quote", () => {
  test("text up to the cap is quoted whole; past it, or opaque, described", () => {
    expect(shareQuote(share(text(A), 32), "x".repeat(32), 32)).toEqual({
      kind: "quoted",
      text: "x".repeat(32),
    })
    expect(shareQuote(share(text(A), 33), "a\nb\nc", 32)).toEqual({
      kind: "described",
      lines: 3,
    })
    expect(shareQuote(share(opaque(A), 3), null, 32)).toEqual({
      kind: "described",
      lines: null,
    })
    expect(shareQuote(share(text(A), 1), "x", 0).kind).toBe("described")
  })

  test("its fence outlasts every run of backticks in the file", () => {
    expect(fenceFor("no ticks")).toBe("```")
    expect(fenceFor("a ```` b ` c")).toBe("`````")
    const body = "````\nnot the end\n````"
    const md = shareQuoteMarkdown(share(text(A), 1), {
      kind: "quoted",
      text: body,
    })
    expect(md).toBe(`\`\`\`\`\`\n${body}\n\`\`\`\`\``)
  })

  test("a described share names its size and how to save it", () => {
    const md = shareQuoteMarkdown(share(opaque(A), 2048), {
      kind: "described",
      lines: null,
    })
    expect(md).toContain("2 KB")
    expect(md).toContain(`save_blob`)
    expect(md).toContain(`/blob/${A}`)
  })

  test("a fitted image's line maps its coordinates back to the original", () => {
    expect(
      fittedLine(share(image(A, 4000, 2000), 1, image(B, 2000, 1000))),
    ).toBe(
      "[f: original 4000x2000, shown at 2000x1000. Multiply coordinates by 2.00 to map to the original.]",
    )
    expect(fittedLine(share(image(A), 1, image(A)))).toBeNull()
    expect(fittedLine(share(text(A), 1))).toBeNull()
  })
})

describe("what a thread may save", () => {
  const messages = [
    { role: "custom", content: `look ![a](/blob/${A})` },
    {
      role: "custom",
      content: `<pinned-cards>\n<card by="Ada">\n[spec](/blob/${B})\n</card>\n</pinned-cards>`,
    },
    {
      role: "toolResult",
      content: [
        {
          type: "image",
          sha256: C,
          mimeType: "image/png",
          width: 1,
          height: 1,
        },
      ],
    },
  ]

  test("readableBlobs: every blob a message on the path showed the model", () => {
    expect([...readableBlobs(messages)].sort()).toEqual([A, B, C])
    expect([...readableBlobs([])]).toEqual([])
  })

  test("planSaveBlob: a blob the path named, by link or hash; anything else refused", () => {
    const readable = readableBlobs(messages)
    expect(planSaveBlob(readable, `/blob/${B}`)).toEqual({
      kind: "save",
      sha256: B,
    })
    expect(planSaveBlob(readable, ` ${A} `)).toEqual({
      kind: "save",
      sha256: A,
    })
    expect(planSaveBlob(readable, `/blob/${"d".repeat(64)}`).kind).toBe(
      "refused",
    )
    expect(planSaveBlob(readable, "notes.txt").kind).toBe("refused")
  })
})
