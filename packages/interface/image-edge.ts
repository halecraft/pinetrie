// interface/image-edge — where on an image in a media column a drop lands:
// its middle is the image itself (a version of it), and a band at each edge
// a spot just before or after it, as a sidebar row has its middle and its
// edges (`sidebarSpot`). The band is fixed, so a tall image keeps most of
// itself for versions.

import type { ImageId } from "@pinetrie/core"

/** Where on an image a drop lands: before it, onto it, or after it. */
export type ImageEdge = "before" | "onto" | "after"

/** How deep each edge's band is, in px, at most: a quarter of a small image. */
export const EDGE_BAND_PX = 24

/**
 * The edge of `box` a point at `at` is in: along its height in a column one
 * image wide, along its width (`across`) where images sit two to a row.
 */
export function imageEdge(
  at: { readonly x: number; readonly y: number },
  box: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  },
  across: boolean,
): ImageEdge {
  const length = across ? box.width : box.height
  const into = across ? at.x - box.left : at.y - box.top
  const band = Math.min(EDGE_BAND_PX, length / 4)
  return into < band ? "before" : into > length - band ? "after" : "onto"
}

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
