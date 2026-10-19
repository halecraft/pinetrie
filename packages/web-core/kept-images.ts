// web-core/kept-images — which files dropped for a media column the host kept
// as images, each under its file's name, and how many were left out. The
// host sorts a file by its bytes, so one it kept with no width is no image.
// The page uploads (`packages/web/image-upload.ts`).

import type { Sha256 } from "@pinetrie/core"

/** An upload's answer, as `SessionClient.upload` gives it, with what this reads of its ref. */
export type ImageUpload =
  | { readonly ok: false }
  | {
      readonly ok: true
      readonly ref: { readonly sha256: Sha256; readonly width: number | null }
    }

/** The images among `uploads`, each named as its file in `names` (the same order), and how many were not. */
export function keptImages(
  uploads: readonly ImageUpload[],
  names: readonly string[],
): {
  readonly images: readonly { readonly sha256: Sha256; readonly name: string }[]
  readonly left: number
} {
  const images = uploads.flatMap((u, i) =>
    u.ok && u.ref.width !== null
      ? [{ sha256: u.ref.sha256, name: names[i] ?? "image" }]
      : [],
  )
  return { images, left: uploads.length - images.length }
}
