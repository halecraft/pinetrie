// pi/images — an image fitted for the store and the model, by pi (ADR-0042),
// and `read`'s images put in the store before pi writes them (ADR-0051).

import { createHash } from "node:crypto"
import type { ReadImageProcessor } from "@earendil-works/pi-agent-core"
import {
  type BlobStore,
  isImageMime,
  type Sha256,
  type StoredImage,
} from "@pinetrie/core"
import {
  detectSupportedImageMimeType,
  formatDimensionNote,
  resizeImage,
} from "./deep.ts"

/** The lower-case hex SHA-256 of `bytes`: a blob's key in the store. */
export const sha256Of = (bytes: Uint8Array): Sha256 =>
  createHash("sha256").update(bytes).digest("hex") as Sha256

export type PreparedImage =
  | {
      readonly ok: true
      readonly image: StoredImage
      /**
       * pi's note for the model when the image was resized: its original
       * size, and the scale that maps a coordinate back to it.
       */
      readonly resized: string | undefined
    }
  | { readonly ok: false; readonly reason: "not an image" | "unreadable" }

/** The box an image is fitted within, in pixels, its ratio kept. */
export interface ImageFit {
  readonly maxWidth: number
  readonly maxHeight: number
}

/**
 * `bytes` as the store keeps them: the type read from the bytes, never
 * declared, and the image fitted to `fit`, else pi's default of 2000×2000,
 * and 4.5 MB of base64, which Anthropic accepts inline (its limit is 5 MB).
 * A person's picture is fitted smaller (ADR-0098). pi's resize returns null
 * both for bytes it cannot decode and for an image nothing fits (S53), hence
 * one reason for both.
 */
export async function prepareImage(
  bytes: Uint8Array,
  fit?: ImageFit,
): Promise<PreparedImage> {
  const sniffed = detectSupportedImageMimeType(bytes)
  if (sniffed === null || !isImageMime(sniffed))
    return { ok: false, reason: "not an image" }
  const resized = await resizeImage(bytes, sniffed, fit)
  if (resized === null) return { ok: false, reason: "unreadable" }
  // A resize gives PNG or JPEG, or the input's own type: never another.
  const mimeType = resized.mimeType
  if (!isImageMime(mimeType)) return { ok: false, reason: "not an image" }
  return {
    ok: true,
    image: {
      bytes: new Uint8Array(Buffer.from(resized.data, "base64")),
      mimeType,
      width: resized.width,
      height: resized.height,
    },
    resized: formatDimensionNote(resized),
  }
}

const OMITTED: Record<Extract<PreparedImage, { ok: false }>["reason"], string> =
  {
    "not an image": "[Image omitted: not an image this harness keeps.]",
    unreadable: "[Image omitted: could not be read or fitted.]",
  }

/**
 * pi's `read`, for an image: fitted as a pasted image is, and put in `blobs`
 * before it is returned, so every write pi makes of the result finds it there
 * by hash and stores a reference (S93). pi adds `hints` to the result's text.
 */
export const readImageProcessor =
  (blobs: Pick<BlobStore, "put">): ReadImageProcessor =>
  async bytes => {
    const prepared = await prepareImage(bytes)
    if (!prepared.ok) return { ok: false, message: OMITTED[prepared.reason] }
    blobs.put(prepared.image)
    return {
      ok: true,
      data: Buffer.from(prepared.image.bytes).toString("base64"),
      mimeType: prepared.image.mimeType,
      hints: prepared.resized === undefined ? [] : [prepared.resized],
    }
  }
