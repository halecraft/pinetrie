// core/images — blobs kept by content, outside the session: images, and a
// reference's quote as markdown.
//
// The bytes live in the host's blob store. A message holds an `ImageRef` for
// each image its text shows, and the text names it by its URL,
// `/blob/<sha256>`. A reference card holds its quote's hash.

declare const sha256Brand: unique symbol
/** The lower-case hex SHA-256 of a blob's stored bytes: its key in the store. */
export type Sha256 = string & { readonly [sha256Brand]: true }

export const isSha256 = (s: string): s is Sha256 => /^[0-9a-f]{64}$/.test(s)

/** The types a blob may have: what every provider accepts inline. */
export const IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const

export type ImageMime = (typeof IMAGE_MIMES)[number]

export const isImageMime = (s: string): s is ImageMime =>
  (IMAGE_MIMES as readonly string[]).includes(s)

/** A blob of text: a reference's quote, as markdown. */
export const TEXT_MIME = "text/markdown"

/** The types a blob may have: an image's, or markdown. */
export type BlobMime = ImageMime | typeof TEXT_MIME

export const isBlobMime = (s: string): s is BlobMime =>
  isImageMime(s) || s === TEXT_MIME

/** An image in the store, as a message holds it: no bytes. */
export interface ImageRef {
  readonly sha256: Sha256
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/** Markdown in the store: no size. */
export interface TextRef {
  readonly sha256: Sha256
  readonly mimeType: typeof TEXT_MIME
  readonly width: null
  readonly height: null
}

/** A blob in the store, read without its bytes. */
export type BlobRef = ImageRef | TextRef

/** Whether a blob is an image: a message's and a model's, never a quote. */
export const isImageRef = (ref: BlobRef): ref is ImageRef =>
  ref.mimeType !== TEXT_MIME

/** An image as it is stored: its bytes, with what a reference says of them. */
export interface StoredImage {
  readonly bytes: Uint8Array
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/** Markdown as it is stored. */
export interface StoredText {
  readonly bytes: Uint8Array
  readonly mimeType: typeof TEXT_MIME
  readonly width: null
  readonly height: null
}

/** A blob as it is stored. */
export type StoredBlob = StoredImage | StoredText

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
  /** Stores the blob, or touches it if it is stored already. */
  put(blob: StoredBlob): BlobRef
  /** The reference, read without the bytes. */
  ref(sha: Sha256): BlobRef | undefined
  get(sha: Sha256): Pick<StoredBlob, "bytes" | "mimeType"> | undefined
  /** Every blob, with when it was last stored or touched (ms since the epoch). */
  list(): readonly { readonly sha256: Sha256; readonly touched: number }[]
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
