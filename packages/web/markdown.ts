// web/markdown — message text as the tree `MessageText` draws
// (docs/findings/S27-markdown-rendering.md).

import {
  addressOfUrl,
  type BlockRef,
  blobOfUrl,
  type ImageRef,
  printAddress,
  type Sha256,
} from "@pinetrie/core"
import {
  BLOCK_PROPERTY,
  type BlockNode,
  blockKey,
  markBlocks,
} from "@pinetrie/rules"
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
  // Every block numbered by the walk an address counts with (`blocksOf`),
  // carried onto its element as `data-block`.
  .use(() => (tree: unknown) => markBlocks(tree as BlockNode))
  // Raw HTML arrives as `raw` nodes, which become text below rather than
  // being dropped: a model writing about `<details>` keeps its words.
  .use(remarkRehype, { allowDangerousHtml: true })
  .freeze()

/** The images a text's `/blob/` sources name, as its message holds them. */
export type ImageLookup = ReadonlyMap<Sha256, ImageRef>

export const NO_IMAGES: ImageLookup = new Map()

/** The images a message holds, by hash. */
export const imageLookup = (
  images: readonly ImageRef[] | undefined,
): ImageLookup =>
  images === undefined
    ? NO_IMAGES
    : new Map(images.map(image => [image.sha256, image]))

/**
 * The tree to draw for a message's text. A `/blob/` image found in `images`
 * gets its stored size, so its box is laid out before it loads: alignment
 * and following measure a message once (ADR-0042). Each block (a table, a
 * code block, an image, a paragraph) carries its number (`data-block`,
 * `markBlocks`), so the column's pane and an address can name it
 * (ADR-0078, ADR-0126).
 */
export function messageTree(
  source: string,
  mode: TextMode,
  images: ImageLookup = NO_IMAGES,
): Root {
  const text = mode === "streaming" ? remend(source, REMEND) : source
  const tree = toHast.runSync(toHast.parse(text))
  tree.children = finish(tree.children, false, images)
  return tree
}

/** The element of a tree `messageTree` made that draws block `ref`, or null. */
export function blockAt(node: Root | Element, ref: BlockRef): Element | null {
  const key = blockKey(ref)
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (child.properties[BLOCK_PROPERTY] === key) return child
    const found = blockAt(child, ref)
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
  images: ImageLookup,
): ElementContent[] {
  const out: ElementContent[] = []
  for (const child of children) {
    if (child.type === "element") {
      for (const key of ["href", "src"] as const) {
        const url = child.properties[key]
        if (typeof url === "string") child.properties[key] = safeUrl(url)
      }
      if (child.tagName === "img") sizeImage(child, images)
      if (child.tagName === "a") markAddress(child)
      child.children = finish(
        child.children,
        inPre || child.tagName === "pre",
        images,
      )
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
 * A link to an address (ADR-0126), `/a/<address>`, drawn as a chip: marked
 * with what it names (`data-address`), which the page's click opens.
 */
function markAddress(a: Element): void {
  const href = a.properties.href
  const address = typeof href === "string" ? addressOfUrl(href) : undefined
  if (address === undefined) return
  a.properties.dataAddress = printAddress(address)
  a.properties.className = ["address-link"]
}

/** A `/blob/` image its message holds: its stored size, and loaded lazily. */
function sizeImage(img: Element, images: ImageLookup): void {
  const src = img.properties.src
  const sha = typeof src === "string" ? blobOfUrl(src) : null
  const ref = sha === null ? undefined : images.get(sha)
  if (ref === undefined) return
  img.properties.width = ref.width
  img.properties.height = ref.height
  img.properties.loading = "lazy"
  img.properties.decoding = "async"
}
