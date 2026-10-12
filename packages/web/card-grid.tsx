// web/card-grid — your inventory's slots, drawn from a `GridView` as index
// cards, empty cells dashed. Every cell is a drop target; a card's cell starts
// its drag. Its keys are `gridKeyAct`'s: arrows and `hjkl` move the selection,
// Alt+arrows move the selected card, Enter opens it, as a click on the selected
// card does. Each cell draws its card's face (`DrawFace`). The open card is
// drawn whole and editable in place, over its neighbours, by the caller
// (`renderOpen`); Escape folds it. Whether it is open is the caller's too, so
// the caller can hide what it draws beside the grid while it is. What a
// selection, a move or a drop does is the caller's: an intent, planned like any
// other.

import type { CardRecord } from "@pinetrie/core"
import {
  type DrawnCard,
  dragProps,
  dropProps,
  type GridView,
  gridKeyAct,
  type PutTarget,
} from "@pinetrie/interface"
import { type ReactNode, useEffect, useRef } from "react"
import { DrawFace } from "./renderings.tsx"
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
  /** The open card, whole: a `CardFrame` around its box. */
  renderOpen: (card: DrawnCard) => ReactNode
  /** The selected card is open, drawn whole. */
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const { view } = p
  const setOpen = p.onOpen
  const grid = useRef<HTMLDivElement>(null)
  const selectedCard = view.card
  const shownOpen = p.open && selectedCard !== null
  // A card that leaves the selected cell folds: put back there (an undo),
  // it is not open again.
  useEffect(() => {
    if (selectedCard === null) setOpen(false)
  }, [selectedCard, setOpen])
  /** Select cell `n`, folded, and give it focus. */
  const select = (n: number) => {
    setOpen(false)
    p.onSelect(n)
    grid.current?.querySelector<HTMLElement>(`[${names.attr}="${n}"]`)?.focus()
  }
  const half = view.grid.width / 2
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
          open: shownOpen,
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
            setOpen(true)
            return
          case "fold":
            select(view.selected)
            return
          // An inventory's cells take no comments.
          case "comment":
            return
        }
      }}
      ref={grid}
      style={{ gridTemplateColumns: `repeat(${view.grid.width}, 8rem)` }}
    >
      {view.cells.map(cell => (
        <div
          className="card-grid-cell"
          data-open={(shownOpen && cell.selected) || undefined}
          key={cell.index}
        >
          <button
            aria-pressed={cell.selected}
            className={cell.card === null ? `${names.cell} empty` : names.cell}
            data-card={cell.card?.id}
            {...{ [names.attr]: String(cell.index) }}
            {...dropProps(p.targetOf(cell.index))}
            {...(cell.card === null
              ? {}
              : dragProps({ kind: "card", card: cell.card.id }))}
            // A click selects, and the panel previews the card; a click on the
            // card already selected opens it, as Enter does.
            onClick={() => {
              const again = cell.selected && cell.card !== null
              select(cell.index)
              if (again) setOpen(true)
            }}
            type="button"
          >
            {cell.face !== null && <DrawFace face={cell.face} />}
          </button>
          {shownOpen && cell.selected && cell.card !== null && (
            <div
              className="card-grid-open"
              data-side={cell.index % view.grid.width < half ? "left" : "right"}
            >
              {p.renderOpen(cell.card)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
