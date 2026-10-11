// paste — what a paste asks the host to write (ADR-0132, ADR-0133): a card
// made from a copy, or a cut card moved out of its paster's trash, and the
// card it takes the place of, if any. The wire carries it as the `paste`
// command; `@pinetrie/rules`' `planPaste` decides it.

import type { Address } from "./address.ts"
import type { CardId, ReferenceCardId, TextCardId } from "./ids.ts"
import type { Sha256 } from "./images.ts"
import type { PlaceKey } from "./places.ts"

/** What one paste makes or moves. */
export type Paste =
  /** A new text card, its text written by its paster first (S96), keeping where it came from. */
  | {
      readonly kind: "text"
      readonly card: TextCardId
      readonly origin: Address | null
    }
  /** A new reference, its quote a blob already kept. */
  | {
      readonly kind: "reference"
      readonly card: ReferenceCardId
      readonly address: Address
      readonly quote: Sha256
    }
  /** A card the paster cut, out of their own trash: the first paste after a cut. */
  | { readonly kind: "uncut"; readonly card: CardId }

/**
 * The card a paste takes the place of, where its paster saw it: a slot's
 * card (ADR-0133), or a reference edited as text. It is discarded first.
 */
export interface Replacing {
  readonly card: CardId
  readonly from: PlaceKey
}
