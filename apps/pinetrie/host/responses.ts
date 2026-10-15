// host/responses — every answer the host gives over HTTP itself, pure: a
// blob, an upload's outcome, an offer's read. `http.ts` writes each one with
// `send`.

import {
  type BlobKind,
  type BlobMime,
  type BlobRef,
  kindOfMime,
  OPAQUE_MIME,
  type StoredBlob,
} from "@pinetrie/core"
import type { OfferAnswer } from "@pinetrie/rules"

export interface HttpAnswer<
  Body extends string | Uint8Array = string | Uint8Array,
> {
  readonly status: number
  readonly headers: Readonly<Record<string, string | number>>
  readonly body: Body
}

/**
 * A blob is named by its bytes' hash, and a review or a diff by a commit and
 * the wire's version, so their answers never change and are cached for a
 * year. A refusal may change a moment later (the offer moved, and its record
 * has not yet arrived), so it is never stored.
 */
const IMMUTABLE = {
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'",
}

export function offerResponse(answer: OfferAnswer): HttpAnswer<string> {
  switch (answer.kind) {
    case "review":
      return {
        status: 200,
        headers: {
          ...IMMUTABLE,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(answer.review),
      }
    case "diff":
      return {
        status: 200,
        headers: { ...IMMUTABLE, "content-type": "text/plain; charset=utf-8" },
        body: answer.text,
      }
    case "refused":
      return {
        status: answer.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
        body: answer.reason,
      }
  }
}

/** How each kind of blob is served, over `IMMUTABLE`'s and the base's headers. */
const BLOB_HEADERS: Readonly<
  Record<BlobKind, (mime: BlobMime) => Readonly<Record<string, string>>>
> = {
  image: mime => ({ "content-type": mime }),
  text: () => ({ "content-type": "text/plain; charset=utf-8" }),
  opaque: () => ({
    "content-type": OPAQUE_MIME,
    "content-disposition": "attachment",
  }),
}

/**
 * Every blob's: a shared file may be HTML or SVG, and the CSP's sandbox keeps
 * one opened on its own from running script as the page's origin.
 */
const BLOB_BASE = { "content-security-policy": "sandbox; default-src 'none'" }

/**
 * `GET /blob/<sha256>`: the stored blob, or 404 for one the store lacks.
 * Text is served as plain text, never drawn as HTML; an opaque blob is a
 * download, named by the link that asks for it.
 */
export function blobResponse(
  blob: Pick<StoredBlob, "bytes" | "mimeType"> | undefined,
): HttpAnswer {
  if (blob === undefined) return { status: 404, headers: {}, body: "" }
  return {
    status: 200,
    headers: {
      ...IMMUTABLE,
      ...BLOB_BASE,
      ...BLOB_HEADERS[kindOfMime(blob.mimeType)](blob.mimeType),
      "content-length": blob.bytes.byteLength,
    },
    body: blob.bytes,
  }
}

/**
 * `POST /blob` refused, with the reason as text. `unread` when the body was
 * not read to its end: the connection cannot then carry another request.
 */
export const uploadRefusal = (
  status: number,
  reason: string,
  unread = false,
): HttpAnswer<string> => ({
  status,
  headers: {
    "content-type": "text/plain",
    ...(unread ? { connection: "close" } : {}),
  },
  body: reason,
})

/** `POST /blob` kept: the blob's reference, as it came. */
export const uploaded = (ref: BlobRef): HttpAnswer<string> => ({
  status: 201,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(ref),
})
