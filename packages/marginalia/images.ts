// marginalia/images — the images a message's markdown shows (ADR-0042).
//
// The host decides what a sent message's images are with the micromark and
// mdast packages that the client's remark-parse and remark-gfm wrap, at the
// same versions, so the images it finds are the ones the client draws. A
// pasted image is `![name](/blob/<sha256>)`.

import {
  blobOfUrl,
  ERR,
  type ImageRef,
  type Refusal,
  refused,
  type Sha256,
} from "@pineta/core"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"

/** The fields of an mdast node this reads; the rest are ignored. */
interface MdNode {
  readonly type: string
  readonly url?: string
  readonly identifier?: string
  readonly children?: readonly MdNode[]
}

/**
 * The source of every image `text` shows, in document order, each once:
 * `![](url)`, and `![][ref]` resolved through the text's definitions. An
 * image inside code is text, and a link to an image is not an image.
 */
export function imageSources(text: string): string[] {
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as MdNode
  const definitions = new Map<string, string>()
  const images: ({ url: string } | { ref: string })[] = []
  const walk = (node: MdNode): void => {
    if (node.type === "definition" && node.identifier !== undefined) {
      // The first definition of an identifier wins, as CommonMark says.
      if (!definitions.has(node.identifier))
        definitions.set(node.identifier, node.url ?? "")
    } else if (node.type === "image" && node.url !== undefined) {
      images.push({ url: node.url })
    } else if (
      node.type === "imageReference" &&
      node.identifier !== undefined
    ) {
      images.push({ ref: node.identifier })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  const sources = images.flatMap(i =>
    "url" in i ? [i.url] : (definitions.get(i.ref) ?? []),
  )
  return [...new Set(sources)]
}

/** The blobs `text` shows, in order, each once. */
export const pastedImages = (text: string): Sha256[] => [
  ...new Set(
    imageSources(text).flatMap(src => {
      const sha = blobOfUrl(src)
      return sha === null ? [] : [sha]
    }),
  ),
]

export type ImagesDecision =
  | { readonly kind: "images"; readonly images: readonly ImageRef[] }
  | Refusal

/**
 * A message's images, from the blobs its text shows and the refs the store
 * holds of them; refused if one is not stored, since the model would then
 * not see what the sender saw. Pure.
 */
export function planImages(
  shas: readonly Sha256[],
  refs: ReadonlyMap<Sha256, ImageRef>,
): ImagesDecision {
  const images: ImageRef[] = []
  for (const sha of shas) {
    const ref = refs.get(sha)
    if (ref === undefined)
      return refused(
        ERR.IMAGE_MISSING,
        `an image in this message is no longer stored (${sha.slice(0, 12)}…): paste it again`,
      )
    images.push(ref)
  }
  return { kind: "images", images }
}
