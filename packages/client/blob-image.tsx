// client/blob-image — an image the host keeps (ADR-0042), as a message's
// markdown or a tool's result draws it. A click shows it over the page in a
// modal `<dialog>` (S66); a Cmd- or Ctrl-click opens it in a new tab.

import { blobOfUrl, blobUrl, type ImageRef } from "@pineta/core"
import {
  type ComponentProps,
  type CSSProperties,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { imageClick } from "./image-click.ts"

/** An image; a `/blob/` one, clicked, is shown over the page. */
export function BlobImage(props: ComponentProps<"img">) {
  const { src, alt } = props
  const [open, setOpen] = useState(false)
  if (typeof src !== "string" || blobOfUrl(src) === null)
    return <img {...props} alt={alt ?? ""} />
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a shortcut for the mouse; the image is not a control */}
      <img
        {...props}
        alt={alt ?? ""}
        className="blob-image"
        onClick={e => {
          if (imageClick(e) === "tab") {
            window.open(src, "_blank", "noopener")
            return
          }
          // An image inside a markdown link shows; the link is not followed.
          e.preventDefault()
          setOpen(true)
        }}
      />
      {open &&
        // In `body`: a pasted image is inside a `<p>`, which cannot hold a
        // `<dialog>`. Its React events still reach the image's ancestors
        // (TECHNICAL.md, "A clicked blob image is shown over the page").
        createPortal(
          <ImageViewer
            alt={alt ?? ""}
            onClose={() => setOpen(false)}
            src={src}
          />,
          document.body,
        )}
    </>
  )
}

/**
 * The image over the page, at its own size or shrunk to fit the window.
 * Escape closes a modal dialog, and gives focus back to what had it; a click
 * does not, so any click, on the backdrop or the image, closes it here.
 */
function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it natively
    <dialog
      aria-label={alt === "" ? "image" : alt}
      className="image-viewer"
      onClick={() => dialog.current?.close()}
      onClose={onClose}
      ref={dialog}
    >
      <img alt={alt} src={src} />
    </dialog>
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
