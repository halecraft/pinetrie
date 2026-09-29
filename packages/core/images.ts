// core/images — images kept by content, outside the session (ADR-0042).
//
// The bytes live in the host's blob store. A message holds an `ImageRef` for
// each image its text shows, and the text names it by its URL,
// `/blob/<sha256>`.

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

/** An image in the store, as a message holds it: no bytes. */
export interface ImageRef {
  readonly sha256: Sha256
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/** An image as it is stored: its bytes, with what a reference says of them. */
export interface StoredImage {
  readonly bytes: Uint8Array
  readonly mimeType: ImageMime
  readonly width: number
  readonly height: number
}

/**
 * The host's blobs. Synchronous, as `node:sqlite` is, so a caller that
 * gathers never awaits between reading the document and reading the store.
 */
export interface BlobStore {
  /** Stores the image, or touches it if it is stored already. */
  put(image: StoredImage): ImageRef
  /** The reference, read without the bytes. */
  ref(sha: Sha256): ImageRef | undefined
  get(sha: Sha256): Pick<StoredImage, "bytes" | "mimeType"> | undefined
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
