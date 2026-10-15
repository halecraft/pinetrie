// web/share-link — a link in a message's text. A shared file's chip
// (`markShare` marks it) opens an image or text in the column's pane, and a
// Cmd- or Ctrl-click opens it in a new tab; an opaque file downloads under
// its name. Every other link is drawn as it is.

import { blobOfUrl } from "@pinetrie/core"
import { type ComponentProps, useContext } from "react"
import { imageClick } from "./image-click.ts"
import type { PaneSubject } from "./pane.ts"
import { samePane } from "./pane.ts"
import { PaneReach } from "./pane-context.ts"

export function ShareLink(
  props: ComponentProps<"a"> & {
    readonly "data-share"?: string
    readonly "data-opens"?: string
  },
) {
  const reach = useContext(PaneReach)
  const { href, download } = props
  const sha = typeof href === "string" ? blobOfUrl(href) : null
  const opens = props["data-opens"]
  if (
    sha === null ||
    props["data-share"] === undefined ||
    (opens !== "image" && opens !== "text") ||
    reach === null
  )
    // biome-ignore lint/a11y/useAnchorContent: its content is its children, in props
    return <a {...props} />
  const mine: PaneSubject = {
    kind: "share",
    sha256: sha,
    name: typeof download === "string" ? download : "",
    image: opens === "image",
  }
  return (
    <a
      {...props}
      href={href}
      data-shown={
        (reach.shown !== null && samePane(reach.shown, mine)) || undefined
      }
      onClick={e => {
        if (imageClick(e) === "tab") return
        e.preventDefault()
        reach.open(mine)
      }}
    />
  )
}
