// host/responses — every answer the host gives over HTTP itself, pure: a blob,
// an upload's outcome, a review's read, stored bytes (`bytesResponse`), and
// the machine's reads (`machineResponse`). `http.ts` writes each one with
// `send`.

import {
  type BlobMime,
  type BlobRef,
  type ImageMime,
  isImageMime,
  OPAQUE_MIME,
  type StoredBlob,
  TEXT_MIME,
} from "@pinetrie/core"
import type { ReviewAnswer } from "@pinetrie/rules"

/** What an answer's body may be: whole, or bytes as they come (a file of a state). */
export type HttpBody = string | Uint8Array | AsyncIterable<Uint8Array>

export interface HttpAnswer<Body extends HttpBody = HttpBody> {
  readonly status: number
  readonly headers: Readonly<Record<string, string | number>>
  readonly body: Body
}

/**
 * A blob is named by its bytes' hash, and a review or a diff by a commit and
 * the wire's version, so their answers never change and are cached for a year.
 * A refusal may change a moment later (the proposed changes moved, and its
 * record has not yet arrived), so it is never stored.
 */
const IMMUTABLE = {
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'",
}

export function reviewResponse(answer: ReviewAnswer): HttpAnswer {
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
    // A state never changes, so its file's bytes are cached as a blob's.
    case "file":
      return bytesResponse(
        isImageMime(answer.content) ? answer.content : "attachment",
        answer.bytes,
        answer.size,
      )
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

/**
 * How stored bytes are served: an image as its type, inline; text as plain
 * text, never drawn as HTML; anything else as a download, named by the link
 * that asks for it. The kind is decided from the bytes, never a name.
 */
export type BytesKind = ImageMime | "text" | "attachment"

const BYTES_HEADERS = (kind: BytesKind): Readonly<Record<string, string>> =>
  kind === "attachment"
    ? { "content-type": OPAQUE_MIME, "content-disposition": "attachment" }
    : kind === "text"
      ? { "content-type": "text/plain; charset=utf-8" }
      : { "content-type": kind }

/**
 * Stored bytes, a blob's or a state's file: cached as immutable, never
 * sniffed, and sandboxed, since a file may be HTML or SVG and the CSP's
 * sandbox keeps one opened on its own from running script as the page's
 * origin. `size` is its length when known.
 */
export function bytesResponse<
  Body extends Uint8Array | AsyncIterable<Uint8Array>,
>(kind: BytesKind, body: Body, size: number | null): HttpAnswer<Body> {
  return {
    status: 200,
    headers: {
      ...IMMUTABLE,
      "content-security-policy": "sandbox; default-src 'none'",
      ...BYTES_HEADERS(kind),
      ...(size === null ? {} : { "content-length": size }),
    },
    body,
  }
}

const BLOB_KIND = (mime: BlobMime): BytesKind =>
  mime === TEXT_MIME ? "text" : mime === OPAQUE_MIME ? "attachment" : mime

/**
 * The machine's reads, each of the moment it is asked, so never stored: the
 * measurements' export (JSON lines), the Health page's facts (JSON), its
 * diagnostics (text).
 */
export const machineResponse = (
  kind: "measurements" | "facts" | "diagnostics",
  body: string,
): HttpAnswer<string> => ({
  status: 200,
  headers: {
    "content-type":
      kind === "measurements"
        ? "application/x-ndjson; charset=utf-8"
        : kind === "facts"
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
    "cache-control": "no-store",
  },
  body,
})

/** `GET /blob/<sha256>`: the stored blob, or 404 for one the store lacks. */
export function blobResponse(
  blob: Pick<StoredBlob, "bytes" | "mimeType"> | undefined,
): HttpAnswer {
  if (blob === undefined) return { status: 404, headers: {}, body: "" }
  return bytesResponse(
    BLOB_KIND(blob.mimeType),
    blob.bytes,
    blob.bytes.byteLength,
  )
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
