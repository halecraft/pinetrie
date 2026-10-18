// interface/thread-icon — what stands before a thread's name, wherever it is
// drawn: its banner, else its noun's built-in icon while the host's icons are
// built in, else nothing (the ✦).

import {
  blobUrl,
  type Noun,
  type ThreadId,
  type ThreadName,
  threadNameParts,
} from "@pinetrie/core"
import type { BannerRecord, IconsRecord } from "@pinetrie/rules"

/**
 * A thread's icon. `banner` is a drawn or pasted image, on the black that
 * `mix-blend-mode: lighten` removes; `built-in` is a 32×32 sprite on a
 * transparent ground, whose dark outline that blend would erase.
 */
export type ThreadIcon =
  | { readonly kind: "banner"; readonly url: string }
  | { readonly kind: "built-in"; readonly url: string }

/** Where the page serves `noun`'s built-in icon: Vite's public directory. */
export const builtInIconUrl = (noun: Noun): string => `/noun-icons/${noun}.png`

/**
 * `thread`'s icon. Its banner record wins under any source. A built-in icon
 * shows only when the host published `built-in`: under `drawn` a thread
 * shows ✦ until its drawn banner arrives, and with no record yet the page
 * cannot tell which, so it shows ✦.
 */
export function threadIcon(input: {
  readonly thread: ThreadId | null
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly banners: ReadonlyMap<ThreadId, BannerRecord>
  readonly icons: IconsRecord | null
}): ThreadIcon | null {
  const { thread } = input
  if (thread === null) return null
  const banner = input.banners.get(thread)
  if (banner !== undefined) return { kind: "banner", url: blobUrl(banner.sha) }
  if (input.icons?.source !== "built-in") return null
  const name = input.names.get(thread)
  const parts = name === undefined ? null : threadNameParts(name)
  return parts === null
    ? null
    : { kind: "built-in", url: builtInIconUrl(parts.noun) }
}

/** A thread's icon, as every view of the page looks it up (`threadIcon`). */
export type IconLookup = (thread: ThreadId) => ThreadIcon | null
