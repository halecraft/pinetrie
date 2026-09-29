// client/message-text — a message's text drawn as markdown, and the DOM side of
// citing a selection in it. What is drawn, and what a selection cites, are
// decided in markdown.ts.

import { blobOfUrl, type ImageRef } from "@pineta/core"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { type ComponentProps, useMemo } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import {
  type Boundary,
  messageTree,
  NO_IMAGES,
  type Run,
  type TextMode,
} from "./markdown.ts"

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
  /** Beside `text`, which the cite button and the browser suite look for. */
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

/** An image; a `/blob/` one, clicked, opens alone in a new tab. */
function BlobImage(props: ComponentProps<"img">) {
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

const RUN = "span[data-s]"

/**
 * The two ends of the page's selection, relative to `text`'s runs, or null if
 * nothing is selected. Only gathers: `citeTarget` decides what they cite.
 */
export function selectionBoundaries(
  text: Element,
): readonly [Boundary, Boundary] | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0)
    return null
  const range = selection.getRangeAt(0)
  const runs = [...text.querySelectorAll(RUN)]
  return [
    boundary(text, runs, range.startContainer, range.startOffset),
    boundary(text, runs, range.endContainer, range.endOffset),
  ]
}

function boundary(
  text: Element,
  runs: readonly Element[],
  node: Node,
  offset: number,
): Boundary {
  if (!text.contains(node)) return { kind: "outside" }
  const parent = node.parentElement
  if (node.nodeType === Node.TEXT_NODE && parent?.matches(RUN) === true) {
    const run = readRun(parent)
    const k = runs.indexOf(parent)
    if (run !== null && offset > 0 && offset < run.value.length)
      return { kind: "in", run, index: offset }
    // A run's edge is between it and its neighbour. A triple-click ends at the
    // start of the next block's first run, which must not pull in the source
    // between the two.
    const neighbour = runs[offset === 0 ? k - 1 : k + 1]
    const other = neighbour === undefined ? null : readRun(neighbour)
    if (run !== null)
      return offset === 0
        ? { kind: "between", before: other, after: run }
        : { kind: "between", before: run, after: other }
  }
  // Between runs, or on an element (a triple-click ends on the next block).
  const point = document.createRange()
  point.setStart(node, offset)
  const after = runs.find(r => point.comparePoint(r, 0) >= 0)
  const before = runs.findLast(
    r => point.comparePoint(r, r.childNodes.length) <= 0,
  )
  return {
    kind: "between",
    before: before === undefined ? null : readRun(before),
    after: after === undefined ? null : readRun(after),
  }
}

/** The one place a run's `data-s`, `data-e` and `data-code` are read back. */
function readRun(el: Element): Run | null {
  const start = Number(el.getAttribute("data-s"))
  const end = Number(el.getAttribute("data-e"))
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  return {
    range: { start, end },
    value: el.textContent ?? "",
    code: el.hasAttribute("data-code"),
  }
}
