// interface/address-words — what an address names, in words:
// a reference's chip and a link's label, and a reference's *Edit as text*.

import type { Address, BlockKind } from "@pinetrie/threads"

/**
 * What a reference names, in words: the chip's label and a link's
 * (`addressLink`). The past's kinds by what they are; a thread or a card by
 * its kind, which its own words name once drawn (`threadLink`).
 */
export function addressWords(address: Address): string {
  switch (address.kind) {
    case "thread":
      return "a thread"
    case "entry":
      return "a message"
    case "range":
      return "a quote"
    case "card":
      return "a card"
    case "block":
      return BLOCK_WORDS[address.block.kind]
  }
}

/** A reference's *Edit as text*. */
export const EDIT_AS_TEXT = {
  label: "Edit as text",
  title:
    "a text card of its quote, in its place, which you can change: the reference goes to your trash",
} as const

const BLOCK_WORDS: Readonly<Record<BlockKind, string>> = {
  table: "a table",
  code: "code",
  image: "an image",
  paragraph: "a paragraph",
}
