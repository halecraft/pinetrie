// web/card-grid — your inventory's slots, drawn from a `GridView` as compact
// cards, empty cells dashed. Every cell is a drop target; a card's cell starts
// its drag. Its keys are `gridKeyAct`'s: arrows and `hjkl` move the selection,
// Alt+arrows move the selected card, Enter opens it on the bench, as a click on
// the selected card does, and Delete or Backspace trashes it, if you may. Each
// cell draws its card's compact (`CompactCard`), with no × of its own: × only
// closes, and the bench's bar holds the trash. Escape is the page's (`keyAct`),
// not the grid's: it folds the bench or closes the panel. What a selection, a
// move or a drop does is the caller's: an intent, planned like any other.

import type { CardRecord } from "@pinetrie/core"
import {
  dropProps,
  type GridView,
  gridKeyAct,
  type PutTarget,
} from "@pinetrie/interface"
import { dragProps } from "@pinetrie/web-core"
import { useRef } from "react"
import { Button } from "./button.tsx"
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
  /** Delete on a cell: its card to your trash. */
  onTrash: (card: CardRecord) => void
  /** Open the selected card on the bench. */
  onOpen: () => void
}) {
  const { view } = p
  const grid = useRef<HTMLDivElement>(null)
  const selectedCard = view.card
  const trashes = view.cells[view.selected]?.trashes === true
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
          trashes,
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
          case "trash":
            if (selectedCard !== null) p.onTrash(selectedCard)
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
          <Button
            look="outline"
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
          >
            {cell.compact !== null && <CompactCard compact={cell.compact} />}
          </Button>
        </div>
      ))}
    </div>
  )
}
