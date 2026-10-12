// web/review-prefs — how you read a review: long lines wrapped or not, and the
// file list folded or not. Your reader's settings, kept per device and the same
// in every column's review; what the pane shows is never kept. `App` provides
// them; `ReviewPane` reads them.

import type { Codec } from "@pinetrie/interface"
import { createContext } from "react"
import { Type } from "typebox"
import { Value } from "typebox/value"

export interface ReviewPrefs {
  /** Long diff lines wrap, rather than scrolling sideways. */
  readonly wrap: boolean
  /** The file list is folded away, giving the diffs the pane's width. */
  readonly listFolded: boolean
}

/** The key the settings are kept under in `localStorage`. */
export const REVIEW_PREFS_KEY = "pinetrie-review"

/** Before you change either: lines scroll, as diffs do, and the list shows. */
export const NO_PREFS: ReviewPrefs = { wrap: false, listFolded: false }

const Stored = Type.Object({ wrap: Type.Boolean(), listFolded: Type.Boolean() })

export const reviewPrefsCodec: Codec<ReviewPrefs> = {
  encode: p => ({ wrap: p.wrap, listFolded: p.listFolded }),
  decode: raw =>
    Value.Check(Stored, raw)
      ? { wrap: raw.wrap, listFolded: raw.listFolded }
      : undefined,
}

export const ReviewPrefsContext = createContext<{
  readonly prefs: ReviewPrefs
  /** Stable: saves for this device, and every review redraws. */
  readonly setPrefs: (prefs: ReviewPrefs) => void
}>({ prefs: NO_PREFS, setPrefs: () => {} })
