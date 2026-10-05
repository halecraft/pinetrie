// client/markdown — message text as the tree `MessageText` draws
// (docs/findings/S27-markdown-rendering.md).

import { blobOfUrl, type ImageRef, type Sha256 } from "@pinetrie/core"
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
 * and following measure a message once (ADR-0042). Each table is numbered
 * in document order (`dataTable`), so the column's pane can name it
 * (ADR-0078).
 */
export function messageTree(
  source: string,
  mode: TextMode,
  images: ImageLookup = NO_IMAGES,
): Root {
  const text = mode === "streaming" ? remend(source, REMEND) : source
  const tree = toHast.runSync(toHast.parse(text))
  tree.children = finish(tree.children, false, images)
  let n = 0
  for (const table of tables(tree)) table.properties.dataTable = n++
  return tree
}

/** The tree's tables in document order, nested ones included. */
function* tables(node: Root | Element): Generator<Element> {
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (child.tagName === "table") yield child
    yield* tables(child)
  }
}

/** The `nth` table of a tree `messageTree` made, or null. */
export function tableAt(tree: Root, nth: number): Element | null {
  for (const table of tables(tree))
    if (table.properties.dataTable === nth) return table
  return null
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
