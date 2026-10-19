// interface/image-edge — what a drop on an image in a media column does: on
// its middle, a version of it; on an edge, a spot just before or after it.
// Which edge a pointer is on is web-core's (`imageEdge`).

import type { ImageId } from "@pinetrie/threads"

/** Where on an image a drop lands: before it, onto it, or after it. */
export type ImageEdge = "before" | "onto" | "after"

/**
 * What a drop on `image`'s `edge` does among `images`, its column's in
 * order: a version of it, or a spot just before an image (null: the end).
 * After an image is just before the next one.
 */
export function imageSpot(
  image: ImageId,
  edge: ImageEdge,
  images: readonly ImageId[],
):
  | { readonly kind: "version"; readonly image: ImageId }
  | { readonly kind: "spot"; readonly before: ImageId | null } {
  if (edge === "onto") return { kind: "version", image }
  if (edge === "before") return { kind: "spot", before: image }
  const at = images.indexOf(image)
  return { kind: "spot", before: at < 0 ? null : (images[at + 1] ?? null) }
}
