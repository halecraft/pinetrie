// rules/shares — a file shared in a message: what its bytes are, the links
// a text shares, and what a message and the model read of each.

import {
  type AgentMessageLike,
  type BlobRef,
  blobOfUrl,
  blobUrl,
  ERR,
  type ImageRef,
  isImageRef,
  isSha256,
  messageImages,
  messageText,
  type Refusal,
  refused,
  type Sha256,
  type Share,
} from "@pinetrie/core"
import { parseMarkdown } from "./markdown.ts"

/**
 * Whether `bytes` are text: valid UTF-8 with no NUL. A text blob is stored as
 * these bytes, so a byte-order mark is kept, not dropped as `TextDecoder`
 * drops it by default.
 */
export function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** Tag 0x8825 in IFD0: where the GPS IFD starts. */
const GPS_IFD_TAG = 0x8825
/** Tag 0x0002 in the GPS IFD: the latitude, without which nothing is placed. */
const GPS_LATITUDE_TAG = 0x0002
/** More entries than any IFD holds: a structure claiming them is not one. */
const MAX_IFD_ENTRIES = 512

/** Whether the TIFF structure at `at` has a GPS IFD holding a latitude. */
function tiffHasLatitude(bytes: Uint8Array, at: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = bytes[at] === 0x49
  const entries = (offset: number): { tag: number; value: number }[] => {
    const p = at + offset
    if (offset < 8 || p + 2 > bytes.length) return []
    const n = view.getUint16(p, le)
    if (n === 0 || n > MAX_IFD_ENTRIES || p + 2 + n * 12 > bytes.length)
      return []
    return Array.from({ length: n }, (_, i) => ({
      tag: view.getUint16(p + 2 + i * 12, le),
      value: view.getUint32(p + 2 + i * 12 + 8, le),
    }))
  }
  if (at + 8 > bytes.length) return false
  const gps = entries(view.getUint32(at + 4, le)).find(
    e => e.tag === GPS_IFD_TAG,
  )
  return (
    gps !== undefined &&
    entries(gps.value).some(e => e.tag === GPS_LATITUDE_TAG)
  )
}

const XMP_LATITUDE = new TextEncoder().encode("GPSLatitude")

/** Whether `needle` occurs in `bytes`. No `Buffer`: the page reads this too. */
function holds(bytes: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0] ?? 0
  for (let i = bytes.indexOf(first); i >= 0; i = bytes.indexOf(first, i + 1)) {
    if (i + needle.length > bytes.length) return false
    let j = 1
    while (j < needle.length && bytes[i + j] === needle[j]) j++
    if (j === needle.length) return true
  }
  return false
}

/**
 * Whether `bytes` hold a location: a GPS latitude in any EXIF block they
 * embed, or in XMP. JPEG, PNG, WebP and HEIC each embed EXIF as a TIFF
 * structure as it is, so one scan reads them all. A container that
 * compresses its metadata is not read, so a false answer claims nothing.
 */
export function hasLocation(bytes: Uint8Array): boolean {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const intel =
      bytes[i] === 0x49 &&
      bytes[i + 1] === 0x49 &&
      bytes[i + 2] === 0x2a &&
      bytes[i + 3] === 0
    const motorola =
      bytes[i] === 0x4d &&
      bytes[i + 1] === 0x4d &&
      bytes[i + 2] === 0 &&
      bytes[i + 3] === 0x2a
    if ((intel || motorola) && tiffHasLatitude(bytes, i)) return true
  }
  return holds(bytes, XMP_LATITUDE)
}

// --- a text's shares ------------------------------------------------------

/** A `/blob/` a text names: as an image (`![]`) or a link (`[]`), and its name. */
export interface TextBlob {
  readonly sha256: Sha256
  readonly name: string
  readonly image: boolean
}

/** The fields of an mdast node this reads; the rest are ignored. */
interface MdNode {
  readonly type: string
  readonly url?: string
  readonly alt?: string | null
  readonly identifier?: string
  readonly value?: string
  readonly children?: readonly MdNode[]
}

const textOf = (node: MdNode): string =>
  node.value ?? (node.children ?? []).map(textOf).join("")

/**
 * Every `/blob/` a text names, in document order, each once: `![](url)` and
 * `[](url)`, and their reference forms resolved through the text's
 * definitions. A link in code is text. The one reader of what
 * `shareMarkdown` writes.
 */
export function textBlobs(text: string): readonly TextBlob[] {
  const tree = parseMarkdown(text) as MdNode
  const definitions = new Map<string, string>()
  const found: ({ url: string } | { ref: string })[] = []
  const names: { name: string; image: boolean }[] = []
  const walk = (node: MdNode): void => {
    if (node.type === "definition" && node.identifier !== undefined) {
      // The first definition of an identifier wins, as CommonMark says.
      if (!definitions.has(node.identifier))
        definitions.set(node.identifier, node.url ?? "")
      return
    }
    const image = node.type === "image" || node.type === "imageReference"
    const link = node.type === "link" || node.type === "linkReference"
    if (image || link) {
      found.push(
        node.url !== undefined
          ? { url: node.url }
          : { ref: node.identifier ?? "" },
      )
      names.push({ name: image ? (node.alt ?? "") : textOf(node), image })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  const seen = new Set<Sha256>()
  return found.flatMap((f, i) => {
    const url = "url" in f ? f.url : definitions.get(f.ref)
    const sha = url === undefined ? null : blobOfUrl(url)
    const named = names[i]
    if (sha === null || named === undefined || seen.has(sha)) return []
    seen.add(sha)
    return [{ sha256: sha, ...named }]
  })
}

/** A share's name in its link: brackets and backslashes escaped, one line. */
const linkLabel = (name: string, fallback: string): string =>
  (name.trim() === "" ? fallback : name.replace(/\s+/g, " ").trim()).replace(
    /[\\[\]]/g,
    "\\$&",
  )

/**
 * A share as markdown: an image as `![name](url)`, any other file as
 * `[name](url)`. The one writer of a share's link.
 */
export const shareMarkdown = (name: string, ref: BlobRef): string =>
  isImageRef(ref)
    ? `![${linkLabel(name, "image")}](${blobUrl(ref.sha256)})`
    : `[${linkLabel(name, "file")}](${blobUrl(ref.sha256)})`

/** What the store holds of one blob a text names, gathered before planning. */
export interface StoredShare {
  readonly ref: BlobRef
  readonly size: number
  /** An image's fitted copy, when it is not the image itself. */
  readonly fitted: ImageRef | undefined
  readonly hasLocation: boolean
}

type SharesDecision =
  | {
      readonly kind: "shares"
      /** What the model reads as image parts, in the text's order. */
      readonly images: readonly ImageRef[]
      readonly shared: readonly Share[]
    }
  | Refusal

/**
 * A message's shares, from the blobs its text names and what the store holds
 * of each: every one a share, and every image's `shown` among the model's
 * image parts. Refused if one is not stored, since the model would then not
 * read what the sender shared.
 */
export function planShares(
  named: readonly TextBlob[],
  stored: ReadonlyMap<Sha256, StoredShare>,
): SharesDecision {
  const shared: Share[] = []
  for (const blob of named) {
    const held = stored.get(blob.sha256)
    if (held === undefined)
      return refused(
        ERR.IMAGE_MISSING,
        `a file in this message is no longer stored (${blob.sha256.slice(0, 12)}…): share it again`,
      )
    shared.push({
      name: blob.name,
      original: held.ref,
      size: held.size,
      shown: isImageRef(held.ref) ? (held.fitted ?? held.ref) : null,
      hasLocation: held.hasLocation,
    })
  }
  return {
    kind: "shares",
    images: shared.flatMap(s => (s.shown === null ? [] : [s.shown])),
    shared,
  }
}

/** The most bytes of a shared text file quoted to the model when no config names a limit. */
export const DEFAULT_QUOTE_BYTES = 32 * 1024

/** What the model reads of a share that is not an image. */
export type ShareQuote =
  | { readonly kind: "quoted"; readonly text: string }
  | { readonly kind: "described"; readonly lines: number | null }

/**
 * A text or opaque share as the model reads it: text up to `quoteBytes`
 * quoted whole, anything else described. `text` is the blob's bytes decoded,
 * or null for an opaque one.
 */
export function shareQuote(
  share: Share,
  text: string | null,
  quoteBytes: number,
): ShareQuote {
  if (text !== null && share.size <= quoteBytes) return { kind: "quoted", text }
  return {
    kind: "described",
    lines: text === null ? null : text.split("\n").length,
  }
}

/** A size as a person reads it: bytes, KB or MB. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A fence for `text`: one backtick longer than its longest run, and at least three. */
export function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map(m => m[0].length),
  )
  return "`".repeat(Math.max(3, longest + 1))
}

/** A share's quote as markdown, the body under its heading (`withQuotes`). */
export function shareQuoteMarkdown(share: Share, quote: ShareQuote): string {
  if (quote.kind === "quoted") {
    const fence = fenceFor(quote.text)
    return `${fence}\n${quote.text}\n${fence}`
  }
  const lines = quote.lines === null ? "" : `, ${quote.lines} lines`
  const what = quote.lines === null ? "a file" : "text"
  return `${what} of ${sizeWords(share.size)}${lines}, not quoted here. Save it into your lane with save_blob and ${blobUrl(share.original.sha256)} to read it.`
}

/**
 * The line before a fitted image's part: the model reads the fitted copy,
 * and a coordinate it gives maps back to the original by the scale.
 */
export function fittedLine(share: Share): string | null {
  const { original, shown } = share
  if (
    shown === null ||
    !isImageRef(original) ||
    shown.sha256 === original.sha256
  )
    return null
  const scale = original.width / shown.width
  return `[${share.name}: original ${original.width}x${original.height}, shown at ${shown.width}x${shown.height}. Multiply coordinates by ${scale.toFixed(2)} to map to the original.]`
}

// --- what a thread may save --------------------------------------------------

declare const readableBrand: unique symbol
/** The blobs a thread's path has shown its model: what `save_blob` may save. */
export type ReadableBlobs = ReadonlySet<Sha256> & {
  readonly [readableBrand]: true
}

const BLOB_URL = /\/blob\/([0-9a-f]{64})/g

/**
 * The blobs `messages` showed the model: every `/blob/<sha256>` in their
 * text as the model read it (a chat's, its quotes, a cards entry's, a
 * reply's, a tool result's), and every stored image part. Read as raw text,
 * not markdown: a cards entry wraps each card in tags a markdown parser
 * reads as HTML, and the model saw the URL either way.
 */
export function readableBlobs(
  messages: readonly (AgentMessageLike | null | undefined)[],
): ReadableBlobs {
  const shas = new Set<Sha256>()
  for (const message of messages) {
    for (const [, sha] of messageText(message).matchAll(BLOB_URL))
      if (sha !== undefined && isSha256(sha)) shas.add(sha)
    for (const image of messageImages(message)) shas.add(image.sha256)
  }
  return shas as ReadonlySet<Sha256> as ReadableBlobs
}

/** `save_blob`'s blob as the agent passed it: `/blob/<sha256>`, or the hash alone. */
export function blobOfArg(arg: string): Sha256 | null {
  const trimmed = arg.trim()
  return isSha256(trimmed) ? trimmed : blobOfUrl(trimmed)
}

export type SaveBlobPlan =
  | { readonly kind: "save"; readonly sha256: Sha256 }
  | { readonly kind: "refused"; readonly text: string }

/** Whether `save_blob` may save `arg`: a blob some message on its path named. */
export function planSaveBlob(
  readable: ReadableBlobs,
  arg: string,
): SaveBlobPlan {
  const sha = blobOfArg(arg)
  if (sha === null)
    return {
      kind: "refused",
      text: `"${arg}" names no blob: pass its /blob/<sha256> link from the message.`,
    }
  return readable.has(sha)
    ? { kind: "save", sha256: sha }
    : {
        kind: "refused",
        text: `No message in this thread shares ${blobUrl(sha)}: save_blob saves only files shared here.`,
      }
}
