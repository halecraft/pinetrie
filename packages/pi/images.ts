// pi/images — an image fitted for the store and the model, by pi (ADR-0042).

import { isImageMime, type StoredImage } from "@pineta/core"
import { detectSupportedImageMimeType, resizeImage } from "./deep.ts"

export type PreparedImage =
  | ({ readonly ok: true } & StoredImage)
  | { readonly ok: false; readonly reason: "not an image" | "unreadable" }

/**
 * `bytes` as the store keeps them: the type read from the bytes, never
 * declared, and the image fitted to 2000×2000 and 4.5 MB of base64, which
 * Anthropic accepts inline (its limit is 5 MB). pi's resize returns null both for bytes it
 * cannot decode and for an image nothing fits (S53), hence one reason for both.
 */
export async function prepareImage(bytes: Uint8Array): Promise<PreparedImage> {
  const sniffed = detectSupportedImageMimeType(bytes)
  if (sniffed === null || !isImageMime(sniffed))
    return { ok: false, reason: "not an image" }
  const resized = await resizeImage(bytes, sniffed)
  if (resized === null) return { ok: false, reason: "unreadable" }
  // A resize gives PNG or JPEG, or the input's own type: never another.
  const mimeType = resized.mimeType
  if (!isImageMime(mimeType)) return { ok: false, reason: "not an image" }
  return {
    ok: true,
    bytes: new Uint8Array(Buffer.from(resized.data, "base64")),
    mimeType,
    width: resized.width,
    height: resized.height,
  }
}
