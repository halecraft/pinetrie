// pi/stored-images — a pi message's images as the session stores them
// (ADR-0051): a reference to the blob store in place of each image's base64,
// and the base64 restored when pi reads the message back. Pure; `KynetaStorage`
// gathers the lookups.

import {
  type ImageMime,
  type ImageRef,
  isSha256,
  type Sha256,
} from "@pineta/core"

/** The namespace of pi's `pendingEntry` values: a message before its entry. */
export const PENDING_ENTRY_NAMESPACE = "pi.pending.entry"

/** A blob's bytes, as the rejoin reads them. */
export type BlobOf = (
  sha: Sha256,
) => { readonly bytes: Uint8Array; readonly mimeType: ImageMime } | undefined

/** The stored image whose bytes are `data` (base64), or undefined. */
export type RefOf = (data: string) => ImageRef | undefined

type Part = { readonly type?: unknown; readonly [key: string]: unknown }

const contentOf = (message: unknown): readonly Part[] | undefined => {
  const content = (message as { content?: unknown } | null)?.content
  return Array.isArray(content) ? content : undefined
}

/** Each inline image part's base64 in `message`, in order. */
export function inlineImages(message: unknown): string[] {
  return (contentOf(message) ?? []).flatMap(p =>
    p?.type === "image" && typeof p.data === "string" ? [p.data] : [],
  )
}

/**
 * `message` with each image part the store has as its reference, without its
 * bytes. A part the store lacks stays inline. The same object when nothing
 * changes.
 */
export function splitImages(message: unknown, refOf: RefOf): unknown {
  const content = contentOf(message)
  if (content === undefined) return message
  let changed = false
  const parts = content.map(p => {
    if (p?.type !== "image" || typeof p.data !== "string") return p
    const ref = refOf(p.data)
    if (ref === undefined) return p
    changed = true
    return {
      type: "image",
      mimeType: ref.mimeType,
      sha256: ref.sha256,
      width: ref.width,
      height: ref.height,
    }
  })
  return changed ? { ...(message as object), content: parts } : message
}

/** A stored reference: an image part with a hash and no bytes. */
const referenceOf = (p: Part): Sha256 | undefined =>
  p?.type === "image" &&
  p.data === undefined &&
  typeof p.sha256 === "string" &&
  isSha256(p.sha256)
    ? p.sha256
    : undefined

/**
 * `message` as pi wrote it: each reference with its bytes restored. A blob no
 * longer stored becomes a text part saying so, so pi still reads a message it
 * can send. The same object when nothing changes.
 */
export function rejoinImages(message: unknown, blobOf: BlobOf): unknown {
  const content = contentOf(message)
  if (content === undefined) return message
  let changed = false
  const parts = content.map(p => {
    const sha = referenceOf(p)
    if (sha === undefined) return p
    changed = true
    const blob = blobOf(sha)
    return blob === undefined
      ? { type: "text", text: `[image ${sha} is no longer stored]` }
      : {
          type: "image",
          data: Buffer.from(blob.bytes).toString("base64"),
          mimeType: blob.mimeType,
        }
  })
  return changed ? { ...(message as object), content: parts } : message
}

/** pi's pending entry, `{type, payload}`: its payload is the message. */
type PendingEntry = { readonly payload?: unknown }

const payloadOf = (value: unknown): unknown =>
  (value as PendingEntry | null)?.payload

const withPayload = (value: unknown, payload: unknown): unknown =>
  payload === payloadOf(value) ? value : { ...(value as object), payload }

/** A pending entry's value with its message's images split. */
export const splitPendingEntry = (value: unknown, refOf: RefOf): unknown =>
  withPayload(value, splitImages(payloadOf(value), refOf))

/** A pending entry's value with its message's images rejoined. */
export const rejoinPendingEntry = (value: unknown, blobOf: BlobOf): unknown =>
  withPayload(value, rejoinImages(payloadOf(value), blobOf))

/** The inline images of a pending entry's message. */
export const pendingImages = (value: unknown): string[] =>
  inlineImages(payloadOf(value))
