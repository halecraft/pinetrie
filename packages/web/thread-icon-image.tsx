// web/thread-icon-image — a thread's icon as an image. Its `data-kind` is what
// the page's CSS draws each kind by: a banner blended off its black, a
// built-in icon unblended.

import type { ThreadIcon } from "@pinetrie/interface"
import type { ComponentProps } from "react"

export function ThreadIconImage({
  icon,
  ...img
}: { icon: ThreadIcon } & Omit<
  ComponentProps<"img">,
  "src" | "alt" | "data-kind"
>) {
  return <img {...img} alt="" data-kind={icon.kind} src={icon.url} />
}
