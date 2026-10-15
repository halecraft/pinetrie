// web/message-text — a message's text drawn as markdown. What is drawn is
// decided in markdown.ts.

import type { ImageRef, Share } from "@pinetrie/core"
import type { Root } from "hast"
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime"
import { type ReactNode, useMemo } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { BlobImage } from "./blob-image.tsx"
import { blobLookup, messageTree, type TextMode } from "./markdown.ts"
import { MessageTable } from "./message-table.tsx"
import { ShareLink } from "./share-link.tsx"

/** A message's tables carry their bar; an image or a shared file opens the pane. */
const IN_MESSAGE: Partial<Components> = {
  a: ShareLink,
  img: BlobImage,
  table: MessageTable,
}

/** A tree `messageTree` made, as React elements; the pane's table uses it too. */
export const drawTree = (
  tree: Root,
  components: Partial<Components> = IN_MESSAGE,
): ReactNode => toJsxRuntime(tree, { Fragment, jsx, jsxs, components })

/**
 * Model output and people's text are never HTML: raw HTML is drawn as text,
 * and a link or image keeps only an http, https, mailto, relative or `#` URL.
 * A `/blob/` image in `images` is drawn at its stored size, and a click opens
 * it in the column's pane (`BlobImage`), as ⤢ does a table (`MessageTable`)
 * and a click a shared file's chip (`ShareLink`).
 */
export function MessageText({
  text,
  mode,
  className,
  images,
  shared,
}: {
  text: string
  mode: TextMode
  /** Beside `text`, which the browser suite looks for. */
  className?: string
  /** The message's images; none for streaming text. */
  images?: readonly ImageRef[] | undefined
  /** The files the message shares; none for streaming text. */
  shared?: readonly Share[] | undefined
}) {
  const lookup = useMemo(() => blobLookup(images, shared), [images, shared])
  const drawn = useMemo(
    () => drawTree(messageTree(text, mode, lookup)),
    [text, mode, lookup],
  )
  return (
    <div className={className === undefined ? "text" : `text ${className}`}>
      {drawn}
    </div>
  )
}
