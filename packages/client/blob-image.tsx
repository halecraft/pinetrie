// client/blob-image — an image the host keeps (ADR-0042), as a message's
// markdown or a tool's result draws it.

import { blobOfUrl, blobUrl, type ImageRef } from "@pineta/core"
import type { ComponentProps, CSSProperties } from "react"

/** An image; a `/blob/` one, clicked, opens alone in a new tab. */
export function BlobImage(props: ComponentProps<"img">) {
  const { src, alt } = props
  if (typeof src !== "string" || blobOfUrl(src) === null)
    return <img {...props} alt={alt ?? ""} />
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a shortcut for the mouse; the image is not a control
    <img
      {...props}
      alt={alt ?? ""}
      className="blob-image"
      onClick={() => window.open(src, "_blank", "noopener")}
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
