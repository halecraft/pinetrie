// web/markdown — message text as the tree `MessageText` draws.

import {
  blobKind,
  blobOfUrl,
  blobUrl,
  type ImageRef,
  type Sha256,
  type Share,
} from "@pinetrie/core"
import {
  BLOCK_PROPERTY,
  type BlockNode,
  blockKey,
  markBlocks,
  shareChip,
} from "@pinetrie/interface"
import { addressOfUrl, type BlockRef, printAddress } from "@pinetrie/threads"
import type { Element, ElementContent, Root, RootContent } from "hast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remend, { type RemendOptions } from "remend"
import { unified } from "unified"

/**
 * Committed text is final. Streaming text is incomplete: remend closes what it
 * leaves open.
 */
export type TextMode = "committed" | "streaming"

/**
 * remend without the handlers that insert escapes mid-text (`20~25` →
 * `20\~25`, `- > 25` → `- \> 25`): with them, a message would render one way
 * while it streams and another once committed.
 */
export const REMEND: RemendOptions = {
  singleTilde: false,
  comparisonOperators: false,
}

const toHast = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  // Every block numbered by the walk an address counts with (`textBlocks`),
  // carried onto its element as `data-block`.
  .use(() => (tree: unknown) => markBlocks(tree as BlockNode))
  // Raw HTML arrives as `raw` nodes, which become text below rather than
  // being dropped: a model writing about `<details>` keeps its words.
  .use(remarkRehype, { allowDangerousHtml: true })
  .freeze()

/**
 * What a message holds of the blobs its text names: its images, by hash, and
 * the files it shares, by their originals' hashes.
 */
interface BlobLookup {
  readonly images: ReadonlyMap<Sha256, ImageRef>
  readonly shares: ReadonlyMap<Sha256, Share>
}

export const NO_BLOBS: BlobLookup = { images: new Map(), shares: new Map() }

/** The blobs a message holds, by hash. */
export const blobLookup = (
  images: readonly ImageRef[] | undefined,
  shared: readonly Share[] | undefined,
): BlobLookup =>
  images === undefined && shared === undefined
    ? NO_BLOBS
    : {
        images: new Map((images ?? []).map(image => [image.sha256, image])),
        shares: new Map((shared ?? []).map(s => [s.original.sha256, s])),
      }

/**
 * The tree to draw for a message's text. A `/blob/` image found in `blobs`
 * gets its stored size, so its box is laid out before it loads: alignment and
 * following measure a message once. A shared image too large to fit draws
 * its fitted copy, and names its original for the pane; a link to any other
 * shared file is a chip. Each block (a table, a code block, an
 * image, a paragraph) carries its number (`data-block`, `markBlocks`), so the
 * column's pane and an address can name it.
 */
export function messageTree(
  source: string,
  mode: TextMode,
  blobs: BlobLookup = NO_BLOBS,
): Root {
  const text = mode === "streaming" ? remend(source, REMEND) : source
  const tree = toHast.runSync(toHast.parse(text))
  tree.children = finish(tree.children, false, blobs)
  return tree
}

/** The element of a tree `messageTree` made that draws block `ref`, or null. */
export function findBlockElement(
  node: Root | Element,
  ref: BlockRef,
): Element | null {
  const key = blockKey(ref)
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (child.properties[BLOCK_PROPERTY] === key) return child
    const found = findBlockElement(child, ref)
    if (found !== null) return found
  }
  return null
}

/** The block an element draws, from its `data-block`; null for none. */
export function blockOfProperty(value: unknown): BlockRef | null {
  if (typeof value !== "string") return null
  const dash = value.lastIndexOf("-")
  const kind = value.slice(0, dash)
  const n = Number(value.slice(dash + 1))
  return (kind === "table" ||
    kind === "code" ||
    kind === "image" ||
    kind === "paragraph") &&
    Number.isInteger(n) &&
    n >= 0
    ? { kind, n }
    : null
}

/** The text of each cell of a table's header row; none without one. */
export function tableHeads(table: Element): readonly string[] {
  const head = table.children.find(
    (c): c is Element => c.type === "element" && c.tagName === "thead",
  )
  const row = head?.children.find(
    (c): c is Element => c.type === "element" && c.tagName === "tr",
  )
  if (row === undefined) return []
  return row.children.flatMap(c =>
    c.type === "element" ? [textOf(c).trim()] : [],
  )
}

const textOf = (node: ElementContent): string =>
  node.type === "text"
    ? node.value
    : node.type === "element"
      ? node.children.map(textOf).join("")
      : ""

function finish(
  children: readonly RootContent[],
  inPre: boolean,
  blobs: BlobLookup,
): ElementContent[] {
  const out: ElementContent[] = []
  for (const child of children) {
    if (child.type === "element") {
      for (const key of ["href", "src"] as const) {
        const url = child.properties[key]
        if (typeof url === "string") child.properties[key] = safeUrl(url)
      }
      if (child.tagName === "img") sizeImage(child, blobs)
      if (child.tagName === "a") markAddress(child)
      child.children = finish(
        child.children,
        inPre || child.tagName === "pre",
        blobs,
      )
      if (child.tagName === "a") markShare(child, blobs)
      out.push(child)
    } else if (child.type === "text" || child.type === "raw") {
      // What to-hast adds between blocks and after a <br> has no position.
      // Dropped, so one `pre-line` rule shows soft breaks and nothing else. The
      // space after a task list's checkbox has no line break, and stays.
      if (
        child.position === undefined &&
        !inPre &&
        isBlockWhitespace(child.value)
      )
        continue
      out.push({ type: "text", value: child.value })
    } else if (child.type === "comment") {
      out.push(child)
    }
  }
  return out
}

const isBlockWhitespace = (value: string): boolean =>
  value.includes("\n") && value.trim() === ""

const SAFE_PROTOCOL = /^(https?|mailto)$/i

/**
 * A link or image URL, or "" if its protocol is not http, https or mailto.
 * Relative and `#` URLs pass. react-markdown's `defaultUrlTransform`: micromark's
 * `sanitizeUri` without its HTML encoding, which a React prop would carry as
 * `&amp;`.
 */
export function safeUrl(url: string): string {
  const colon = url.indexOf(":")
  const questionMark = url.indexOf("?")
  const numberSign = url.indexOf("#")
  const slash = url.indexOf("/")
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(url.slice(0, colon))
  )
    return url
  return ""
}

/**
 * A link to a file its message shares, drawn as a chip: its name, format
 * and size, and a warning when it holds a location (`shareChip`). Marked
 * with its blob (`data-share`) for the page's click, and named for a download.
 */
function markShare(a: Element, blobs: BlobLookup): void {
  const href = a.properties.href
  const sha = typeof href === "string" ? blobOfUrl(href) : null
  const share = sha === null ? undefined : blobs.shares.get(sha)
  if (sha === null || share === undefined) return
  const chip = shareChip(share)
  a.properties.className = ["share-chip"]
  a.properties.dataShare = sha
  a.properties.dataOpens =
    chip.opens === "download" ? "download" : blobKind(share.original)
  a.properties.download = chip.name
  const span = (className: string, value: string): ElementContent => ({
    type: "element",
    tagName: "span",
    properties: { className: [className] },
    children: [{ type: "text", value }],
  })
  a.children = [
    { type: "text", value: `${chip.name} ` },
    span("share-chip-meta", chip.meta),
    ...(chip.location === null
      ? []
      : [span("share-chip-location", ` · ${chip.location}`)]),
  ]
}

/**
 * A link to an address, `/a/<address>`, drawn as a chip: marked with what it
 * names (`data-address`), which the page's click opens.
 */
function markAddress(a: Element): void {
  const href = a.properties.href
  const address = typeof href === "string" ? addressOfUrl(href) : undefined
  if (address === undefined) return
  a.properties.dataAddress = printAddress(address)
  a.properties.className = ["address-link"]
}

/** The property naming a fitted image's original, which the pane opens. */
export const ORIGINAL_PROPERTY = "dataOriginal"

/**
 * A `/blob/` image its message holds: its stored size, and loaded lazily. A
 * shared image is drawn as its `shown` copy, its original named beside it.
 */
function sizeImage(img: Element, blobs: BlobLookup): void {
  const src = img.properties.src
  const sha = typeof src === "string" ? blobOfUrl(src) : null
  const shown = sha === null ? null : (blobs.shares.get(sha)?.shown ?? null)
  if (sha !== null && shown !== null && shown.sha256 !== sha) {
    img.properties.src = blobUrl(shown.sha256)
    img.properties[ORIGINAL_PROPERTY] = blobUrl(sha)
  }
  const ref = shown ?? (sha === null ? undefined : blobs.images.get(sha))
  if (ref === undefined) return
  img.properties.width = ref.width
  img.properties.height = ref.height
  img.properties.loading = "lazy"
  img.properties.decoding = "async"
}
