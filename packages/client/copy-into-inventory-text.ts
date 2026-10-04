// client/copy-into-inventory-text — what taking a copy of a message into
// the inventory copies (ADR-0048: taking from the past copies). Pure.

import type { TranscriptMessage } from "@pineta/core"
import { copyText } from "./copy-text.ts"

/** The page's selection when "take a copy into your inventory" is pressed: its text, and whether it lies within the message. */
export interface SelectionLike {
  readonly text: string
  readonly inside: boolean
}

/** Your selection's text when it lies within the message, else the whole message as `copyText` gives it. */
export const copyIntoInventoryText = (
  message: TranscriptMessage,
  selection: SelectionLike | null,
): string =>
  selection?.inside === true && selection.text.trim() !== ""
    ? selection.text
    : copyText(message)
