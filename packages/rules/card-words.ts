// card-words — what a card says, read from where its kind keeps its words
// (`cardTextSource`).

import type { Sha256, TextCardId, TextSource } from "@pinetrie/core"
import { factLine } from "./fact.ts"
import { askLine } from "./relay.ts"

/** Where a reader of card words reads a document's text and a blob's, each loaded first. */
interface WordReaders {
  readonly doc: (card: TextCardId) => string
  /** A reference's quote; "" for a blob not loaded. */
  readonly blob: (sha: Sha256) => string
}

/**
 * What a card says, from where its words are (`cardTextSource`): a text
 * card's document; a reference's quote, a blob; a fact's line; an ask's
 * line; nothing for a card with no words. Every reader of card words reads
 * through it.
 */
export function sourceWords(source: TextSource, read: WordReaders): string {
  switch (source.kind) {
    case "doc":
      return read.doc(source.card)
    case "blob":
      return read.blob(source.sha)
    case "fact":
      return factLine(source.fact)
    case "ask":
      return askLine(source.relay)
    case "none":
      return ""
  }
}
