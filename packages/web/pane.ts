// web/pane — what a column's pane shows, as values: the subject a column holds,
// what it draws from the column's facts, and the pane's words; `pane.tsx` draws
// it.

import {
  type Address,
  type AskIndex,
  askSpan,
  blobUrl,
  type EntryId,
  printAddress,
  type RevisionRecord,
  type Sha256,
  type SpineNode,
  type TreeIndex,
} from "@pinetrie/core"
import type { ReviewTarget } from "@pinetrie/interface"
import type { Element, Root } from "hast"
import { blockAt, imageLookup, messageTree, tableHeads } from "./markdown.ts"

/** A block of a message, by its address. */
export type BlockAddress = Extract<Address, { readonly kind: "block" }>

/**
 * What a column's pane shows: a name, never data, so the pane can tell when its
 * subject is gone. Kept while the column is mounted, never stored. A table or
 * an image of a message's text is a block, named by its address; an image that
 * is no block of a message (a tool's result, or one in a reply still streaming,
 * which has no entry yet) by its blob.
 */
export type PaneSubject =
  | { readonly kind: "offer" }
  | { readonly kind: "ask"; readonly ask: EntryId }
  | { readonly kind: "block"; readonly address: BlockAddress }
  | {
      readonly kind: "image"
      readonly sha256: Sha256
      readonly alt: string
      readonly title?: string
    }

/**
 * A subject's name as a string: the same exactly when two subjects name the
 * same thing. The pane is keyed by it, so another subject mounts afresh.
 */
export function paneKey(subject: PaneSubject): string {
  switch (subject.kind) {
    case "offer":
      return "offer"
    case "ask":
      return `ask:${subject.ask}`
    case "block":
      return `block:${printAddress(subject.address)}`
    case "image":
      return `image:${subject.sha256}`
  }
}

export const samePane = (a: PaneSubject, b: PaneSubject): boolean =>
  paneKey(a) === paneKey(b)

/** Opening what is shown closes it; anything else replaces it. */
export const togglePane = (
  shown: PaneSubject | null,
  next: PaneSubject,
): PaneSubject | null => (shown !== null && samePane(shown, next) ? null : next)

export type PaneView =
  | {
      readonly kind: "review"
      readonly target: ReviewTarget
      readonly line: string
    }
  | { readonly kind: "table"; readonly table: Element; readonly title: string }
  | {
      readonly kind: "image"
      readonly src: string
      readonly alt: string
      readonly title: string
    }

export interface PaneFacts {
  /** The strip's review and its line, while the offer has one. */
  readonly offer: {
    readonly target: ReviewTarget
    readonly line: string
  } | null
  /** The messages the column draws (`ColumnView.nodes`). */
  readonly nodes: readonly SpineNode[]
  /** An ask's review, or null when it has none (`askReviewTarget`). */
  readonly askTarget: (ask: EntryId) => ReviewTarget | null
}

/**
 * What to draw for `subject`, or null when it is gone: the offer has no
 * review, the column no longer draws the message, an ask has no span, the
 * message has no such table. Null closes the pane.
 */
export function paneView(
  subject: PaneSubject,
  facts: PaneFacts,
): PaneView | null {
  switch (subject.kind) {
    case "offer":
      return facts.offer === null ? null : { kind: "review", ...facts.offer }
    case "ask": {
      const target = facts.askTarget(subject.ask)
      return target === null
        ? null
        : { kind: "review", target, line: ASK_REVIEW_LINE }
    }
    case "block": {
      const { address } = subject
      const node = facts.nodes.find(n => n.id === address.entry)
      if (node === undefined) return null
      const block = blockAt(treeOf(node), address.block)
      if (block === null) return null
      const { src, alt, title } = block.properties
      switch (address.block.kind) {
        case "table":
          return {
            kind: "table",
            table: block,
            title: tableTitle(tableHeads(block)),
          }
        case "image":
          return typeof src !== "string"
            ? null
            : {
                kind: "image",
                src,
                alt: typeof alt === "string" ? alt : "",
                title: imageTitle(
                  typeof alt === "string" ? alt : "",
                  typeof title === "string" ? title : undefined,
                ),
              }
        // A paragraph or code is read in its message: the pane opens none.
        case "paragraph":
        case "code":
          return null
      }
      return null
    }
    case "image":
      return {
        kind: "image",
        src: blobUrl(subject.sha256),
        alt: subject.alt,
        title: imageTitle(subject.alt, subject.title),
      }
  }
}

/**
 * A message's tree, parsed once per node. `App` keeps a column's nodes while
 * the index is the same, so the column can ask for its pane's view on every
 * render, and a table keeps its identity, which `TablePane` is memoised on.
 */
const trees = new WeakMap<SpineNode, Root>()
function treeOf(node: SpineNode): Root {
  const known = trees.get(node)
  if (known !== undefined) return known
  const tree = messageTree(node.text, "committed", imageLookup(node.images))
  trees.set(node, tree)
  return tree
}

/**
 * An ask's files as a review: the range from its prompt's commit to its last
 * turn's, titled with its line. Null when it changed nothing, or its lane
 * recorded no revision.
 */
export function askReviewTarget(
  index: TreeIndex,
  asks: AskIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  ask: EntryId,
  title: string | null,
): ReviewTarget | null {
  const span = askSpan(index, asks, ask, revisions)
  const lane = revisions.get(ask)?.lane
  if (span === null || lane === undefined) return null
  return {
    lane,
    spans: [span],
    conflicts: [],
    yourEdits: [],
    ...(title === null ? {} : { title }),
  }
}

/**
 * `.column-thread`'s width, and `.pane`'s narrowest and widest, in rem. `.pane`
 * is `clamp(40rem, 100cqw - 28rem - 1px, 64rem)`, with `#strip` its container:
 * it fills what the strip has beside the thread. `pane.test.ts` holds
 * `index.html` to these.
 */
export const THREAD_REM = 28
export const PANE_MIN_REM = 40
export const PANE_MAX_REM = 64
/**
 * `.column`'s right border: the one edge between the thread and the pane
 * that is outside `.pane`'s box.
 */
export const COLUMN_EDGE_PX = 1

/**
 * Whether a strip `width` px wide is too narrow for the thread beside the
 * pane at its narrowest: the pane then covers the page. `rem` is the root
 * font size in px.
 */
export const narrowStrip = (width: number, rem: number): boolean =>
  width < (THREAD_REM + PANE_MIN_REM) * rem + COLUMN_EDGE_PX

/** The line heading an ask's review. */
export const ASK_REVIEW_LINE = "what this ask changed"

/** The image pane's link to the image alone. */
export const OPEN_IN_TAB = "open in a new tab"

/** The pane's accessible name, by what it shows. */
export const paneLabel = (kind: PaneView["kind"]): string =>
  `${kind} beside the thread`

/** A table's ⤢: closed, shown in the pane, or in a reply still written. */
export type TableOpenState = "closed" | "shown" | "streaming"

export function tableOpenWords(state: TableOpenState): {
  readonly label: string
  readonly title: string
} {
  switch (state) {
    case "closed":
      return {
        label: "open the table beside the thread",
        title: "open beside the thread",
      }
    case "shown":
      return { label: "close the table", title: "close the table" }
    case "streaming":
      return {
        label: "open the table beside the thread",
        title: "the reply is still being written",
      }
  }
}

/** The pane's close control: back to the thread over a narrow screen. */
export const paneCloseWords = (
  narrow: boolean,
): { readonly glyph: string; readonly label: string } =>
  narrow
    ? { glyph: "←", label: "back to the thread" }
    : { glyph: "×", label: "close" }

/** A table's title in the pane: its header row, or "table". */
export function tableTitle(heads: readonly string[]): string {
  const named = heads.filter(h => h !== "")
  return named.length === 0 ? "table" : named.join(" · ")
}

/** An image's title in the pane: its alt, then its title, then "image". */
export const imageTitle = (alt: string, title: string | undefined): string =>
  alt !== "" ? alt : title !== undefined && title !== "" ? title : "image"
