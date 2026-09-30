// client/message-text — a message's text drawn as markdown. What is drawn is
// decided in markdown.ts.

import type { ImageRef } from "@pineta/core"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { useMemo } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { BlobImage } from "./blob-image.tsx"
import { messageTree, NO_IMAGES, type TextMode } from "./markdown.ts"

/**
 * Model output and people's text are never HTML: raw HTML is drawn as text,
 * and a link or image keeps only an http, https, mailto, relative or `#` URL.
 * A `/blob/` image in `images` is drawn at its stored size, and opens in a
 * new tab when clicked.
 */
export function MessageText({
  text,
  mode,
  className,
  images,
}: {
  text: string
  mode: TextMode
  /** Beside `text`, which the browser suite looks for. */
  className?: string
  /** The message's images (ADR-0042); none for streaming text and notes. */
  images?: readonly ImageRef[] | undefined
}) {
  const lookup = useMemo(
    () =>
      images === undefined
        ? NO_IMAGES
        : new Map(images.map(image => [image.sha256, image])),
    [images],
  )
  const drawn = useMemo(
    () =>
      toJsxRuntime(messageTree(text, mode, lookup), {
        Fragment,
        jsx,
        jsxs,
        components: { img: BlobImage },
      }),
    [text, mode, lookup],
  )
  return (
    <div className={className === undefined ? "text" : `text ${className}`}>
      {drawn}
    </div>
  )
}
