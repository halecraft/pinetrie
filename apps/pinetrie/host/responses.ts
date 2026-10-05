// host/responses — every answer the host gives over HTTP itself, pure: an
// image blob (ADR-0042), an upload's outcome, an offer's read (ADR-0047).
// `http.ts` writes each one with `send`.

import type { ImageRef, StoredImage } from "@pinetrie/core"
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

/** `GET /blob/<sha256>`: the stored image, or 404 for one the store lacks. */
export function blobResponse(
  blob: Pick<StoredImage, "bytes" | "mimeType"> | undefined,
): HttpAnswer {
  if (blob === undefined) return { status: 404, headers: {}, body: "" }
  return {
    status: 200,
    headers: {
      ...IMMUTABLE,
      "content-type": blob.mimeType,
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

/** `POST /blob` kept: the image's reference. */
export const uploaded = (ref: ImageRef): HttpAnswer<string> => ({
  status: 201,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(ref),
})
