// client/markdown — message text as markdown, and which source each rendered
// character came from, so a selection in it still cites `entryText` offsets
// (ADR-0017, docs/findings/S27-markdown-rendering.md).

import {
  blobOfUrl,
  type EntryId,
  type ImageRef,
  type ReferenceTarget,
  type Sha256,
} from "@pineta/core"
import { decodeNamedCharacterReference } from "decode-named-character-reference"
import type { Element, ElementContent, Root, RootContent } from "hast"
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remend, { type RemendOptions } from "remend"
import { unified } from "unified"

/** UTF-16 offsets into a message's source, end exclusive. */
export interface SourceRange {
  readonly start: number
  readonly end: number
}

/**
 * A rendered run of text, and the source range that produced it. In code,
 * backslashes and `&` are literal, so its text aligns character for character.
 */
export interface Run {
  readonly range: SourceRange
  readonly value: string
  readonly code: boolean
}

/** One end of a selection, as the DOM placed it. */
export type Boundary =
  | { readonly kind: "in"; readonly run: Run; readonly index: number }
  | {
      readonly kind: "between"
      readonly before: Run | null
      readonly after: Run | null
    }
  /** Not inside this message's text. */
  | { readonly kind: "outside" }

/**
 * Committed text is final and citable, so its text is wrapped in runs.
 * Streaming text is incomplete: remend closes what it leaves open, and it is
 * never citable.
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

/**
 * The tree to draw for a message's text. A `/blob/` image found in `images`
 * gets its stored size, so its box is laid out before it loads: alignment
 * and following measure a message once (ADR-0042).
 */
export function messageTree(
  source: string,
  mode: TextMode,
  images: ImageLookup = NO_IMAGES,
): Root {
  const text = mode === "streaming" ? remend(source, REMEND) : source
  const tree = toHast.runSync(toHast.parse(text))
  tree.children = finish(tree.children, {
    source: text,
    runs: mode === "committed",
    parent: undefined,
    inPre: false,
    inherited: undefined,
    images,
  })
  return tree
}

interface Walk {
  readonly source: string
  readonly runs: boolean
  readonly parent: Element | undefined
  readonly inPre: boolean
  /** The nearest positioned ancestor's range: code text has none of its own. */
  readonly inherited: SourceRange | undefined
  readonly images: ImageLookup
}

function finish(children: readonly RootContent[], w: Walk): ElementContent[] {
  const out: ElementContent[] = []
  for (const child of children) {
    if (child.type === "element") {
      for (const key of ["href", "src"] as const) {
        const url = child.properties[key]
        if (typeof url === "string") child.properties[key] = safeUrl(url)
      }
      if (child.tagName === "img") sizeImage(child, w.images)
      child.children = finish(child.children, {
        ...w,
        parent: child,
        inPre: w.inPre || child.tagName === "pre",
        inherited: rangeOf(child) ?? w.inherited,
      })
      out.push(child)
    } else if (child.type === "text" || child.type === "raw") {
      out.push(...textOf(child.value, rangeOf(child), w))
    } else if (child.type === "comment") {
      out.push(child)
    }
  }
  return out
}

/** A text or raw node as it is drawn: dropped, plain text, or a run. */
function textOf(
  value: string,
  own: SourceRange | undefined,
  w: Walk,
): ElementContent[] {
  // What to-hast adds between blocks and after a <br>. Dropped, so one
  // `pre-line` rule shows soft breaks and nothing else. The space after a task
  // list's checkbox has no line break, and stays.
  if (own === undefined && !w.inPre && isBlockWhitespace(value)) return []
  const plain: ElementContent = { type: "text", value }
  if (!w.runs) return [plain]
  const inCode = w.parent?.tagName === "code"
  // Any other text without a position is generated (a footnote's label and
  // backlink): it has no source, so it is not a run.
  const range = own ?? (inCode ? w.inherited : undefined)
  if (range === undefined) return [plain]
  if (!inCode) return [run({ range, value, code: false })]
  const content = codeContent(w.source, range, w.inPre)
  // to-hast ends a code block's value with a newline the source may lack.
  if (w.inPre && value.endsWith("\n"))
    return [
      run({ range: content, value: value.slice(0, -1), code: true }),
      { type: "text", value: "\n" },
    ]
  return [run({ range: content, value, code: true })]
}

const isBlockWhitespace = (value: string): boolean =>
  value.includes("\n") && value.trim() === ""

function run({ range, value, code }: Run): Element {
  return {
    type: "element",
    tagName: "span",
    // Only when true: a false data attribute would be drawn as "false".
    properties: code
      ? { dataS: range.start, dataE: range.end, dataCode: true }
      : { dataS: range.start, dataE: range.end },
    children: [{ type: "text", value }],
  }
}

function rangeOf(node: {
  position?: {
    start: { offset?: number | undefined }
    end: { offset?: number | undefined }
  }
}): SourceRange | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? undefined : { start, end }
}

/**
 * Where a code element's text starts in its range: past a fenced block's
 * fence line, or past inline code's opening backticks. Without this, the
 * alignment matches the first characters of `sh -c` in ```` ```sh ````.
 */
function codeContent(
  source: string,
  range: SourceRange,
  block: boolean,
): SourceRange {
  let start = range.start
  if (block) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, range.end))) {
      const newline = source.indexOf("\n", start)
      start = newline === -1 || newline >= range.end ? range.end : newline + 1
    }
  } else {
    while (start < range.end && source[start] === "`") start++
  }
  return { start, end: range.end }
}

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

/** For each code unit of a run, the source token that produced it. */
export interface Alignment {
  readonly starts: readonly number[]
  readonly ends: readonly number[]
}

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/

/**
 * Match each code unit of a run to its source token: a backslash escape, a
 * character reference, or a literal character; in code, only literals. Source
 * characters that produce nothing (indentation, `>` markers, trimmed spaces)
 * are skipped. Null if the value is not matched before the range ends.
 */
export function align(
  { value, range, code }: Run,
  source: string,
): Alignment | null {
  const starts: number[] = []
  const ends: number[] = []
  let j = range.start
  let i = 0
  const take = (length: number, units: number) => {
    for (let k = 0; k < units; k++) {
      starts.push(j)
      ends.push(j + length)
    }
    i += units
    j += length
  }
  while (i < value.length) {
    if (j >= range.end) return null
    const ch = source[j]
    // In text, `\` before punctuation and `&…;` are always tokens, even where
    // their first character alone would match.
    if (!code) {
      const next = source[j + 1] ?? ""
      if (ch === "\\" && ASCII_PUNCTUATION.test(next) && next === value[i]) {
        take(2, 1)
        continue
      }
      const ref = ch === "&" ? characterReference(source, j) : null
      if (ref !== null && value.startsWith(ref.text, i)) {
        take(ref.length, ref.text.length)
        continue
      }
    }
    if (ch === value[i]) {
      // Of a longer run of spaces, the last ones are the value's: the first
      // are indentation (code in a list item).
      if (ch === " " || ch === "\t") {
        const extra = runLength(source, j, range.end) - runLength(value, i)
        if (extra > 0) j += extra
      }
      take(1, 1)
      continue
    }
    j++
  }
  return { starts, ends }
}

function runLength(text: string, at: number, end = text.length): number {
  let n = 0
  while (at + n < end && text[at + n] === text[at]) n++
  return n
}

const REFERENCE =
  /^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));/

/** The character reference at `at`, decoded as micromark decodes it. */
function characterReference(
  source: string,
  at: number,
): { text: string; length: number } | null {
  const m = REFERENCE.exec(source.slice(at, at + 40))
  if (m === null) return null
  const [whole, hex, decimal, name] = m
  const text =
    hex !== undefined
      ? decodeNumericCharacterReference(hex, 16)
      : decimal !== undefined
        ? decodeNumericCharacterReference(decimal, 10)
        : decodeNamedCharacterReference(name ?? "")
  return text === false ? null : { text, length: whole.length }
}

/**
 * A boundary inside a run, as a source offset. A start is where its
 * character's token starts; an end is where the previous character's ends, so
 * a selection of "bold" in `**bold**` leaves the asterisks out.
 */
export function sourcePoint(
  source: string,
  run: Run,
  index: number,
  side: "start" | "end",
): number | null {
  const a = align(run, source)
  if (a === null) return null
  const n = run.value.length
  if (n === 0) return run.range.start
  const at =
    side === "start"
      ? index < n
        ? a.starts[index]
        : a.ends[n - 1]
      : index > 0
        ? a.ends[index - 1]
        : a.starts[0]
  return at ?? null
}

/**
 * What a cite click cites: the span of source the selection covers, or the
 * whole entry when it covers none (both ends in one gap between runs, an end
 * outside the message, or text with no source).
 */
export function citeTarget(
  source: string,
  id: EntryId,
  start: Boundary,
  end: Boundary,
): ReferenceTarget {
  const s = boundaryOffset(source, start, "start")
  const e = boundaryOffset(source, end, "end")
  return s === null || e === null || s >= e
    ? { kind: "entry", id }
    : { kind: "span", id, start: s, end: e }
}

/** A start between runs snaps forward to the next run, an end back to the last. */
function boundaryOffset(
  source: string,
  b: Boundary,
  side: "start" | "end",
): number | null {
  switch (b.kind) {
    case "outside":
      return null
    case "in":
      return sourcePoint(source, b.run, b.index, side)
    case "between": {
      const run = side === "start" ? b.after : b.before
      if (run === null) return null
      const index = side === "start" ? 0 : run.value.length
      return sourcePoint(source, run, index, side)
    }
  }
}
