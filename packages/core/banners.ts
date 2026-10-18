// core/banners — a thread's banner as recorded, and where threads' icons come
// from.

import type { ThreadId } from "./ids.ts"
import type { Sha256 } from "./images.ts"

/**
 * The image behind a thread's column header: a host-written `pinetrie.banner`
 * value keyed by the lane. The image is a blob; a replaced one is no longer
 * referenced, and the blob sweep deletes it.
 */
export interface BannerRecord {
  readonly lane: ThreadId
  readonly sha: Sha256
  readonly at: number
}

/** Where threads' icons come from: the config's `icons.source`. */
export const ICON_SOURCES = ["built-in", "drawn", "none"] as const
export type IconSource = (typeof ICON_SOURCES)[number]

/**
 * The host's icon source, published for the page as the one
 * `pinetrie.icons` value: the page shows a built-in icon only under
 * `built-in`, so it never shows one before a drawn one arrives.
 */
export interface IconsRecord {
  readonly source: IconSource
}
