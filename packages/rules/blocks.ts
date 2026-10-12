// rules/blocks — the blocks of a message's text, numbered once, so the block
// the page draws and the block an address names cannot be counted differently.

import type { BlockKind, BlockRef } from "@pinetrie/core"
import { parseMarkdown } from "./markdown.ts"

/** The fields of an mdast node this reads and writes; the rest are kept. */
export interface BlockNode {
  readonly type: string
  readonly position?: {
    readonly start: { readonly offset?: number }
    readonly end: { readonly offset?: number }
  }
  readonly children?: readonly BlockNode[]
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>
}

/** The mdast node types that are blocks, by the kind each is numbered as. */
const KIND_OF: Readonly<Record<string, BlockKind>> = {
  table: "table",
  code: "code",
  image: "image",
  paragraph: "paragraph",
}

/** Each block of `tree` with its number, in document order, nested ones included. */
export function numberBlocks(
  tree: BlockNode,
): readonly { readonly node: BlockNode; readonly ref: BlockRef }[] {
  const counts = new Map<BlockKind, number>()
  const out: { node: BlockNode; ref: BlockRef }[] = []
  const walk = (node: BlockNode): void => {
    const kind = KIND_OF[node.type]
    if (kind !== undefined) {
      const n = counts.get(kind) ?? 0
      counts.set(kind, n + 1)
      out.push({ node, ref: { kind, n } })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}

/** The property a drawn block carries its number in (`data-block`). */
export const BLOCK_PROPERTY = "dataBlock"

/** A block's number as text: `table-0`. */
export const blockKey = (ref: BlockRef): string => `${ref.kind}-${ref.n}`

/**
 * Label every block of an mdast tree with its number (`BLOCK_PROPERTY`),
 * which `remark-rehype` carries onto the element it draws. In place.
 */
export function markBlocks(tree: BlockNode): void {
  for (const { node, ref } of numberBlocks(tree))
    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        [BLOCK_PROPERTY]: blockKey(ref),
      },
    }
}

/** A block of a text: its number, and where it is in the text, `to` excluded. */
export interface Block {
  readonly ref: BlockRef
  readonly from: number
  readonly to: number
}

/** The blocks of `text`, as `markBlocks` numbers them. */
export function blocksOf(text: string): readonly Block[] {
  const tree = parseMarkdown(text) as BlockNode
  return numberBlocks(tree).flatMap(({ node, ref }) => {
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    return from === undefined || to === undefined ? [] : [{ ref, from, to }]
  })
}

/** A block's source slice of `text`: its markdown; null when it has none. */
export function blockSource(text: string, ref: BlockRef): string | null {
  const block = blocksOf(text).find(
    b => b.ref.kind === ref.kind && b.ref.n === ref.n,
  )
  return block === undefined ? null : text.slice(block.from, block.to)
}
