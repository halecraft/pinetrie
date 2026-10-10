// rules/links — links to addresses in text (ADR-0126): `[label](/a/<address>)`,
// a relative URL `safeUrl` keeps, as it keeps `/blob/`. What the agent reads
// of a message quotes each linked referent under it, gathered by the host.
// Pure; read from the tree the client draws (`parseMarkdown`).

import {
  type Address,
  addressOfUrl,
  addressUrl,
  isPastAddress,
  type PastAddress,
} from "@pinetrie/core"
import { blockSource } from "./blocks.ts"
import { parseMarkdown } from "./markdown.ts"

interface LinkNode {
  readonly type: string
  readonly url?: string
  readonly value?: string
  readonly children?: readonly LinkNode[]
}

/** A link to an address in a text: what it names, and its label. */
export interface AddressLink {
  readonly address: Address
  readonly label: string
}

const textOf = (node: LinkNode): string =>
  node.value ?? (node.children ?? []).map(textOf).join("")

/** Every link to an address in `text`, in document order. A link in code is text. */
export function addressLinks(text: string): readonly AddressLink[] {
  const tree = parseMarkdown(text) as LinkNode
  const out: AddressLink[] = []
  const walk = (node: LinkNode): void => {
    const address =
      node.type === "link" && node.url !== undefined
        ? addressOfUrl(node.url)
        : undefined
    if (address !== undefined) out.push({ address, label: textOf(node) })
    else for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}

/** A link to `address` labelled `label`, as markdown: what a put into a text box inserts. */
export const addressLink = (address: Address, label: string): string =>
  `[${label.replace(/[[\]]/g, "")}](${addressUrl(address)})`

/**
 * The markdown of a past address from its message's text as stored: the
 * whole text for an entry, a block's source slice, a range's slice. Null
 * when the block is not there. Tool calls are the interface's to add
 * (`markdownOf`): the host quotes the text alone.
 */
export function pastMarkdown(
  address: PastAddress,
  messageText: string,
): string | null {
  switch (address.kind) {
    case "entry":
      return messageText
    case "block":
      return blockSource(messageText, address.block)
    case "range":
      return messageText.slice(address.from, address.to)
  }
}

/** A linked referent the model reads: its link's label, and its markdown. */
export interface LinkedQuote {
  readonly label: string
  readonly markdown: string
}

/**
 * Each past referent `text` links to, with its markdown from the message
 * it is in (`messageText`; undefined for an entry this host does not
 * hold), in link order. A link to a thread or a card is followed by no
 * quote: neither is a part of the past. Pure.
 */
export const linkedQuotes = (
  text: string,
  messageText: (address: PastAddress) => string | undefined,
): readonly LinkedQuote[] =>
  addressLinks(text).flatMap(({ address, label }) => {
    if (!isPastAddress(address)) return []
    const source = messageText(address)
    const markdown = source === undefined ? null : pastMarkdown(address, source)
    return markdown === null ? [] : [{ label, markdown }]
  })

/** Markdown quoted, each line prefixed `> `. */
const quoted = (markdown: string): string =>
  markdown
    .split("\n")
    .map(line => (line === "" ? ">" : `> ${line}`))
    .join("\n")

/**
 * What the model reads of a message with links: its content, then each
 * linked referent's markdown quoted under it, named by its link's label.
 * `quotes` are the referents found, in link order; those not found are left
 * out. Pure.
 */
export function withQuotes(
  content: string,
  quotes: readonly LinkedQuote[],
): string {
  const found = quotes.filter(q => q.markdown.trim() !== "")
  return found.length === 0
    ? content
    : [
        content,
        ...found.map(q => `Linked: ${q.label}\n${quoted(q.markdown)}`),
      ].join("\n\n")
}
