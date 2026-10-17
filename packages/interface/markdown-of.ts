// interface/markdown-of — the markdown of what an address names: what Cmd+C
// puts on the system clipboard and what a reference keeps as its quote, from
// one rule.

import type { Address, EntryId, TranscriptMessage } from "@pinetrie/core"
import { addressLink, pastMarkdown } from "@pinetrie/rules"
import { copyText } from "./copy-text.ts"

/**
 * `address`'s markdown, from the message it is in: an entry whole, its tool
 * calls included (`copyText`); a block's source slice (`blockSource`); a
 * range's slice of the text as stored. "" for a thread or a card, which are
 * linked, not quoted, and for an entry this tab does not hold.
 */
export function addressMarkdown(
  address: Address,
  facts: {
    readonly messageOf: (entry: EntryId) => TranscriptMessage | undefined
  },
): string {
  if (address.kind === "thread" || address.kind === "card") return ""
  const message = facts.messageOf(address.entry)
  if (message === undefined) return ""
  // An entry's copy has its tool calls too; a part of it, its text's.
  return address.kind === "entry"
    ? copyText(message)
    : (pastMarkdown(address, message.text) ?? "")
}

/**
 * A comment's quote, as a queued reference to it sends it: a link to the entry
 * it is on, then its text. The agent reads the entry quoted under the link
 * (`pastMarkdown`, the host's), so the comment reads under what it is about.
 */
export const commentMarkdown = (entry: Address, text: string): string =>
  `A comment on ${addressLink(entry, "a message")}:\n\n${text.trim()}`
