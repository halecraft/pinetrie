// interface/focus — where focus is, as one record the page gathers once
// (`focusFacts`, `packages/web/focus.ts`): what the keys (`keyAct`), a copy
// (`clipOfFocus`) and a paste's target (`targetOfFocus`) decide from. Pure:
// no DOM here, only what was read of it.

import type { BlockRef, CardId } from "@pinetrie/core"
import type { PutTarget } from "./put-target.ts"

/** Where focus is when a key is pressed, or a copy or a paste happens. */
export interface Focus {
  /** The card whose box or heading has focus (`data-card`), if any. */
  readonly card: CardId | null
  /** Focus is in a text box: its undo keys, its copy and its text are its own. */
  readonly inText: boolean
  /** Focus is in the inventory panel. */
  readonly inPanel: boolean
  /** The card in the inventory's selected slot, if any. */
  readonly selectedCard: CardId | null
  /** The column that last held focus, by key: where a put lands. */
  readonly column: string | null
  /**
   * A page covers the stage (ADR-0098): no key but the list's fold acts,
   * since a take, a put or an undo would act on columns no one can see.
   */
  readonly page: boolean
  /**
   * Where search stands: "unavailable" with no tree shown (a new tab, the
   * board), "focused" while open with focus in the bar, a match list or
   * nowhere.
   */
  readonly search: "unavailable" | "closed" | "open" | "focused"
  /**
   * A selection that is not collapsed: inside one message (its entry, as
   * the page read it from `data-entry`), or elsewhere (null).
   */
  readonly selection: {
    readonly entry: string | null
    readonly text: string
  } | null
  /** A focused block (`[data-block]` in `.msg[data-entry]`), as the page read it. */
  readonly block: { readonly entry: string; readonly block: BlockRef } | null
  /**
   * The column's selected message (`.msg[data-selected]`), only while focus
   * is inside that column: a selection left behind never beats a focused card.
   */
  readonly selected: string | null
  /** Focus is on the clipboard cell (ADR-0132). */
  readonly cell: boolean
  /**
   * The card column focus is inside now (not the last one), its index among
   * the canvas's columns and how many there are: what Alt+← and Alt+→ move.
   */
  readonly inColumn: {
    readonly card: CardId
    readonly position: number
    readonly count: number
  } | null
  /** The nearest drop zone around focus (`targetOfElement`): where a paste lands. */
  readonly zone: PutTarget | null
}
