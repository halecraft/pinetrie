// web/card-grid — your inventory's slots, drawn from a `GridView` as compact
// cards, empty cells dashed. Every cell is a drop target; a card's cell starts
// its drag. Its keys are `gridKeyAct`'s: arrows and `hjkl` move the selection,
// Alt+arrows move the selected card, Enter opens it on the bench, as a click on
// the selected card does. Each cell draws its card's compact (`CompactCard`),
// and a card you may discard its ×. Escape is the page's (`keyAct`), not the
// grid's: it folds the bench or closes the panel. What a selection, a move or
// a drop does is the caller's: an intent, planned like any other.

import type { CardRecord } from "@pinetrie/core"
import {
  DISCARD_CARD,
  DISCARD_SLOT_TITLE,
  dragProps,
  dropProps,
  type GridView,
  gridKeyAct,
  type PutTarget,
} from "@pinetrie/interface"
import { useRef } from "react"
import { CompactCard } from "./renderings.tsx"
import { isTextBox } from "./text-box.ts"

/** The grid's own names: its class, and its cells' class and attribute. */
const names = { grid: "inventory-grid", cell: "slot", attr: "data-slot" }

export function CardGrid(p: {
  view: GridView
  /** Where a drop on cell `n` lands. */
  targetOf: (n: number) => PutTarget
  onSelect: (n: number) => void
  /** The selected card to cell `to`, a card there swapping with it. */
  onMove: (card: CardRecord, to: number) => void
  /** A cell's ×: its card to your trash. */
  onDiscard: (card: CardRecord) => void
  /** Open the selected card on the bench. */
  onOpen: () => void
}) {
  const { view } = p
  const grid = useRef<HTMLDivElement>(null)
  const selectedCard = view.card
  /** Select cell `n` and give it focus. */
  const select = (n: number) => {
    p.onSelect(n)
    grid.current?.querySelector<HTMLElement>(`[${names.attr}="${n}"]`)?.focus()
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the grid's keys; each cell is a button
    <div
      className={`card-grid ${names.grid}`}
      onKeyDown={e => {
        const act = gridKeyAct(e, {
          grid: view.grid,
          rows: view.rows,
          selected: view.selected,
          hasCard: selectedCard !== null,
          open: false,
          inText: isTextBox(document.activeElement),
          comments: false,
        })
        if (act === null) return
        e.preventDefault()
        switch (act.kind) {
          case "select":
            select(act.cell)
            return
          case "move":
            if (selectedCard !== null) p.onMove(selectedCard, act.to)
            return
          case "open":
            p.onOpen()
            return
          // The bench's open card folds by the page's Escape; an inventory's
          // cells take no comments.
          case "fold":
          case "comment":
            return
        }
      }}
      ref={grid}
      style={{
        gridTemplateColumns: `repeat(${view.grid.width}, var(--compact-w))`,
      }}
    >
      {view.cells.map(cell => (
        <div className="card-grid-cell" key={cell.index}>
          <button
            aria-pressed={cell.selected}
            className={cell.card === null ? `${names.cell} empty` : names.cell}
            data-card={cell.card?.id}
            {...{ [names.attr]: String(cell.index) }}
            {...dropProps(p.targetOf(cell.index))}
            {...(cell.card === null
              ? {}
              : dragProps({ kind: "card", card: cell.card.id }))}
            // A click selects, and the bench shows the card; a click on the
            // card already selected opens it there, as Enter does.
            onClick={() => {
              const again = cell.selected && cell.card !== null
              select(cell.index)
              if (again) p.onOpen()
            }}
            type="button"
          >
            {cell.compact !== null && <CompactCard compact={cell.compact} />}
          </button>
          {/* Beside the cell's button, not in it: a button holds no button. */}
          {cell.discards && cell.card !== null && (
            <button
              aria-label={DISCARD_SLOT_TITLE}
              className="slot-discard"
              data-card={cell.card.id}
              onClick={() => {
                if (cell.card !== null) p.onDiscard(cell.card)
              }}
              title={DISCARD_SLOT_TITLE}
              type="button"
            >
              {DISCARD_CARD}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
