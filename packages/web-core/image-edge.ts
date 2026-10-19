// web-core/image-edge — which edge of an image in a media column a pointer
// is on: its middle is the image itself, and a band at each edge a spot just
// before or after it, as a sidebar row has its middle and its edges
// (`sidebarSpot`). The band is fixed, so a tall image keeps most of itself for
// versions. What a drop there does is interface's (`imageSpot`).

import type { ImageEdge } from "@pinetrie/interface"

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
