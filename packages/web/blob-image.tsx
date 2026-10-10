// web/blob-image — an image the host keeps (ADR-0042), as a message's
// markdown or a tool's result draws it. A click opens it in the column's pane
// (ADR-0078); a Cmd- or Ctrl-click opens it in a new tab.

import { blobOfUrl, blobUrl, type ImageRef } from "@pinetrie/core"
import { type ComponentProps, type CSSProperties, useContext } from "react"
import { imageClick } from "./image-click.ts"
import { blockOfProperty } from "./markdown.ts"
import { type PaneSubject, samePane } from "./pane.ts"
import { MessageSource, PaneReach } from "./pane-context.ts"

/**
 * An image; a `/blob/` one, clicked, opens in the column's pane, outlined
 * while it shows there. Outside a column it is only drawn.
 */
export function BlobImage(
  props: ComponentProps<"img"> & { readonly "data-block"?: string },
) {
  const { src, alt, title } = props
  const reach = useContext(PaneReach)
  const source = useContext(MessageSource)
  const sha = typeof src === "string" ? blobOfUrl(src) : null
  if (typeof src !== "string" || sha === null || reach === null)
    return <img {...props} alt={alt ?? ""} />
  // A block of a committed message is named by its address (ADR-0126); an
  // image of a tool's result, or of a reply still streaming, by its blob.
  const block = blockOfProperty(props["data-block"])
  const mine: PaneSubject =
    block !== null && source?.kind === "entry"
      ? {
          kind: "block",
          address: {
            kind: "block",
            thread: source.thread,
            entry: source.entry,
            block,
          },
        }
      : {
          kind: "image",
          sha256: sha,
          alt: alt ?? "",
          ...(title === undefined ? {} : { title }),
        }
  const shown = reach.shown !== null && samePane(reach.shown, mine)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a shortcut for the mouse; the image is not a control
    <img
      {...props}
      alt={alt ?? ""}
      className="blob-image"
      data-shown={shown || undefined}
      onClick={e => {
        if (imageClick(e) === "tab") {
          window.open(src, "_blank", "noopener")
          return
        }
        // An image inside a markdown link opens; the link is not followed.
        e.preventDefault()
        reach.open(mine)
      }}
    />
  )
}

/**
 * A stored image at its stored size, loaded lazily. The size holds its box
 * before the bytes arrive, so a column that aligns or follows measures it
 * once. `--ratio` is its width over its height, for CSS that caps its height
 * by capping its width: overriding `width` would lose the box until it loads.
 */
export function StoredImage({
  image,
  alt,
  title,
}: {
  image: ImageRef
  alt: string
  title?: string | undefined
}) {
  return (
    <BlobImage
      alt={alt}
      decoding="async"
      height={image.height}
      loading="lazy"
      src={blobUrl(image.sha256)}
      style={{ "--ratio": image.width / image.height } as CSSProperties}
      title={title}
      width={image.width}
    />
  )
}
