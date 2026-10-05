// client/message-text — a message's text drawn as markdown. What is drawn is
// decided in markdown.ts.

import type { ImageRef } from "@pinetrie/core"
import type { Root } from "hast"
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime"
import { type ReactNode, useMemo } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { BlobImage } from "./blob-image.tsx"
import { imageLookup, messageTree, type TextMode } from "./markdown.ts"
import { MessageTable } from "./message-table.tsx"

/** A message's tables carry their bar; an image opens the pane. */
const IN_MESSAGE: Partial<Components> = { img: BlobImage, table: MessageTable }

/** A tree `messageTree` made, as React elements; the pane's table uses it too. */
export const drawTree = (
  tree: Root,
  components: Partial<Components> = IN_MESSAGE,
): ReactNode => toJsxRuntime(tree, { Fragment, jsx, jsxs, components })

/**
 * Model output and people's text are never HTML: raw HTML is drawn as text,
 * and a link or image keeps only an http, https, mailto, relative or `#` URL.
 * A `/blob/` image in `images` is drawn at its stored size, and a click opens
 * it in the column's pane (`BlobImage`), as ⤢ does a table (`MessageTable`).
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
  /** The message's images (ADR-0042); none for streaming text. */
  images?: readonly ImageRef[] | undefined
}) {
  const lookup = useMemo(() => imageLookup(images), [images])
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
