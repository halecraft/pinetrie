// web/focus — where focus is, read once from the page (`Focus`,
// `@pinetrie/interface`): the keys (`keyAct`), a copy (`clipOfFocus`) and a
// paste's target (`targetOfFocus`) decide from it. It reads; it decides
// nothing.

import { type CardId, parseCardId } from "@pinetrie/core"
import { DROP_ZONE, type Focus, targetOfElement } from "@pinetrie/interface"
import { blockOfProperty } from "./markdown.ts"
import { isTextBox } from "./text-box.ts"

/** What the page holds beside the DOM: the selected slot's card, the column last in, a page, the search. */
export interface FocusContext {
  readonly selectedCard: CardId | null
  readonly column: string | null
  readonly page: boolean
  readonly search: Focus["search"]
}

const cardOrNull = (id: string | undefined): CardId | null =>
  id === undefined ? null : (parseCardId(id) ?? null)

/** Where focus is now, and the selection. */
export function focusFacts(at: FocusContext): Focus {
  const el = document.activeElement
  const html = el instanceof HTMLElement ? el : null
  const inText = isTextBox(el)
  const blockEl = html?.closest<HTMLElement>("[data-block]") ?? null
  const blockEntry =
    blockEl?.closest<HTMLElement>(".msg[data-entry]")?.dataset.entry
  const block = blockOfProperty(blockEl?.dataset.block)
  const zoneEl = html?.closest(DROP_ZONE) ?? null
  return {
    card: cardOrNull(html?.closest<HTMLElement>("[data-card]")?.dataset.card),
    inText,
    inPanel: el?.closest(".inventory") != null,
    selectedCard: at.selectedCard,
    column: at.column,
    page: at.page,
    search: at.search,
    selection: inText ? null : selectionFacts(),
    block:
      blockEntry === undefined || block === null
        ? null
        : { entry: blockEntry, block },
    // Only the column focus is in: a selection left behind elsewhere never
    // beats a focused card.
    selected:
      html
        ?.closest(".column")
        ?.querySelector<HTMLElement>(".msg[data-selected]")?.dataset.entry ??
      null,
    cell: el?.closest(".clipboard-cell") != null,
    inColumn: columnOf(html),
    zone: zoneEl === null ? null : targetOfElement(zoneEl),
  }
}

/** The card column `el` is inside, by its index among the strip's card columns. */
function columnOf(el: HTMLElement | null): Focus["inColumn"] {
  const column = el?.closest<HTMLElement>("#strip > [data-card]") ?? null
  const card = cardOrNull(column?.dataset.card)
  if (column === null || card === null) return null
  const columns = [
    ...(column.parentElement?.querySelectorAll(":scope > [data-card]") ?? []),
  ]
  return { card, position: columns.indexOf(column), count: columns.length }
}

/** A selection that is not collapsed: its text, and the message it is all inside, if any. */
function selectionFacts(): Focus["selection"] {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0)
    return null
  const common = selection.getRangeAt(0).commonAncestorContainer
  const around = common instanceof Element ? common : common.parentElement
  const entry =
    around?.closest<HTMLElement>(".msg[data-entry]")?.dataset.entry ?? null
  return { entry, text: selection.toString() }
}
