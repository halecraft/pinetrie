// core/images — blobs kept by content, outside the session: images, text
// (a reference's quote, a shared file in UTF-8) and opaque files.
//
// The bytes live in the host's blob store. A message's text names each blob
// it shares by its URL, `/blob/<sha256>`, and holds a ref for each. A
// reference card holds its quote's hash.

import type { FileContent } from "./folder.ts"

declare const sha256Brand: unique symbol
/** The lower-case hex SHA-256 of a blob's stored bytes: its key in the store. */
export type Sha256 = string & { readonly [sha256Brand]: true }

export const isSha256 = (s: string): s is Sha256 => /^[0-9a-f]{64}$/.test(s)

/** The types an image blob may have: what every provider accepts inline. */
export const IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const

export type ImageMime = (typeof IMAGE_MIMES)[number]

export const isImageMime = (s: string): s is ImageMime =>
  (IMAGE_MIMES as readonly string[]).includes(s)

/** How much of a file's start `fileContent` reads: git's own window for telling text. */
export const FILE_CONTENT_WINDOW = 8000

const startsWith = (head: Uint8Array, at: number, bytes: readonly number[]) =>
  bytes.every((b, i) => head[at + i] === b)

const ascii = (text: string) => [...text].map(c => c.charCodeAt(0))

/**
 * What a file's first bytes (up to `FILE_CONTENT_WINDOW`) say it holds:
 * text by git's rule, no NUL byte among them; else an image by its magic
 * bytes; else binary. An SVG is text, never an image to draw: a page
 * drawing it would run what it holds.
 */
export function fileContent(head: Uint8Array): FileContent {
  const window = head.subarray(0, FILE_CONTENT_WINDOW)
  if (!window.includes(0)) return "text"
  if (startsWith(window, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png"
  if (startsWith(window, 0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (
    startsWith(window, 0, ascii("GIF87a")) ||
    startsWith(window, 0, ascii("GIF89a"))
  )
    return "image/gif"
  if (
    startsWith(window, 0, ascii("RIFF")) &&
    startsWith(window, 8, ascii("WEBP"))
  )
    return "image/webp"
  return "binary"
}

/**
 * A blob of text: a reference's quote, or a shared file that is UTF-8. The
 * tag is the one quotes were first stored under, kept so their rows decode.
 */
export const TEXT_MIME = "text/markdown"

/** A blob that is neither an image pi can fit nor UTF-8 text. */
export const OPAQUE_MIME = "application/octet-stream"

/** The tags a stored blob may have: an image's type, text's, or opaque's. */
export type BlobMime = ImageMime | typeof TEXT_MIME | typeof OPAQUE_MIME

export const isBlobMime = (s: string): s is BlobMime =>
  isImageMime(s) || s === TEXT_MIME || s === OPAQUE_MIME

/** What a blob is, read from its bytes when it was stored. */
type BlobKind = "image" | "text" | "opaque"

/** An image in the store, as a message holds it: no bytes. */
export interface ImageRef {
  readonly sha256: Sha256
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/** Text in the store: no dimensions. */
interface TextRef {
  readonly sha256: Sha256
  readonly mimeType: typeof TEXT_MIME
  readonly width: null
  readonly height: null
}

/** An opaque blob in the store: no dimensions. */
interface OpaqueRef {
  readonly sha256: Sha256
  readonly mimeType: typeof OPAQUE_MIME
  readonly width: null
  readonly height: null
}

/** A blob in the store, read without its bytes. */
export type BlobRef = ImageRef | TextRef | OpaqueRef

/** A stored blob's kind, from its tag. */
const kindOfMime = (mime: BlobMime): BlobKind =>
  mime === TEXT_MIME ? "text" : mime === OPAQUE_MIME ? "opaque" : "image"

export const blobKind = (ref: BlobRef): BlobKind => kindOfMime(ref.mimeType)

/** Whether a blob is an image: what a model reads as one, never a quote. */
export const isImageRef = (ref: BlobRef): ref is ImageRef =>
  blobKind(ref) === "image"

/**
 * A file a message shares: the blob as it came (`original`), its size, and
 * the name its link gives it. `shown` is what the column draws inline and the
 * model reads of an image: the original itself when it fitted, else its
 * fitted copy; null for text and opaque files.
 */
export interface Share {
  readonly name: string
  readonly original: BlobRef
  readonly size: number
  readonly shown: ImageRef | null
  /** Whether its bytes hold a GPS position (EXIF or XMP). */
  readonly hasLocation: boolean
}

/** An image as it is stored: its bytes, with what a reference says of them. */
export interface StoredImage {
  readonly bytes: Uint8Array
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/** Text as it is stored: its UTF-8 bytes. */
interface StoredText {
  readonly bytes: Uint8Array
  readonly mimeType: typeof TEXT_MIME
  readonly width: null
  readonly height: null
}

/** An opaque blob as it is stored. */
interface StoredOpaque {
  readonly bytes: Uint8Array
  readonly mimeType: typeof OPAQUE_MIME
  readonly width: null
  readonly height: null
}

/** A blob as it is stored. */
export type StoredBlob = StoredImage | StoredText | StoredOpaque

/** `text` as a blob to store. */
export const storedText = (text: string): StoredText => ({
  bytes: new TextEncoder().encode(text),
  mimeType: TEXT_MIME,
  width: null,
  height: null,
})

/**
 * The host's blobs. Synchronous, as `node:sqlite` is, so a caller that
 * gathers never awaits between reading the document and reading the store.
 */
export interface BlobStore {
  /**
   * Stores the blob, or touches it if it is stored already; with `fitted`,
   * stores that too and records it as the blob's fitted copy.
   */
  put(blob: StoredBlob, fitted?: StoredImage): BlobRef
  /** The reference, read without the bytes. */
  ref(sha: Sha256): BlobRef | undefined
  /** The blob's size in bytes, read without the bytes. */
  size(sha: Sha256): number | undefined
  /** An image's fitted copy, when it is not the image itself. */
  fitted(sha: Sha256): ImageRef | undefined
  get(sha: Sha256): Pick<StoredBlob, "bytes" | "mimeType"> | undefined
  /** Every blob, with when it was last stored or touched (ms since the epoch). */
  list(): readonly { readonly sha256: Sha256; readonly touched: number }[]
  /** Deletes the blobs, and each one's record of a fitted copy. */
  delete(shas: readonly Sha256[]): void
}

const BLOB_PREFIX = "/blob/"

/** Where the host serves a blob. */
export const blobUrl = (sha: Sha256): string => `${BLOB_PREFIX}${sha}`

/** The blob a URL names, exactly as `blobUrl` writes it, or null. */
export function blobOfUrl(url: string): Sha256 | null {
  if (!url.startsWith(BLOB_PREFIX)) return null
  const sha = url.slice(BLOB_PREFIX.length)
  return isSha256(sha) ? sha : null
}
