// interface/markdown-of — the markdown of what an address names (ADR-0126):
// what Cmd+C puts on the system clipboard and what a reference keeps as its
// quote, from one rule. Pure.

import type { Address, EntryId, TranscriptMessage } from "@pinetrie/core"
import { pastMarkdown } from "@pinetrie/rules"
import { copyText } from "./copy-text.ts"

/**
 * `address`'s markdown, from the message it is in: an entry whole, its tool
 * calls included (`copyText`); a block's source slice (`blockSource`); a
 * range's slice of the text as stored. "" for a thread or a card, which are
 * linked, not quoted, and for an entry this tab does not hold.
 */
export function markdownOf(
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
