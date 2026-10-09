// web/card-grid — your inventory's slots (ADR-0048), drawn from a
// `GridView` as index cards, empty cells dashed. Every cell is a drop
// target; a card's cell starts its drag. Its keys are `gridKeyAct`'s: arrows
// and `hjkl` move the selection, Alt+arrows move the selected card, Enter
// opens it. The open card is drawn whole and editable in place, over its
// neighbours, by the caller (`renderOpen`); Escape folds it. What a
// selection, a move or a drop does is the caller's: an intent, planned like
// any other.

import type { CardRecord, WriterId } from "@pinetrie/core"
import {
  dropProps,
  type GridView,
  gridKeyAct,
  type PutTarget,
  type Reader,
} from "@pinetrie/interface"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CardFace, dragCard } from "./card-frame.tsx"
import { isTextBox } from "./text-box.ts"
import { ThreadFaceView } from "./thread-preview.tsx"

/** The grid's own names: its class, and its cells' class and attribute. */
const names = { grid: "inventory-grid", cell: "slot", attr: "data-slot" }

export function CardGrid(p: {
  view: GridView
  /** Where a drop on cell `n` lands. */
  targetOf: (n: number) => PutTarget
  reader: Reader
  colorOf: (writer: WriterId) => string
  onSelect: (n: number) => void
  /** The selected card to cell `to`, a card there swapping with it. */
  onMove: (card: CardRecord, to: number) => void
  /** The open card, whole: a `CardFrame` around its box. */
  renderOpen: (card: CardRecord) => ReactNode
  /** Each change asks to open the selected card: a link to a thread you hold (ADR-0124). */
  openRequest: number
}) {
  const { view } = p
  const [open, setOpen] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const selectedCard = view.card
  const shownOpen = open && selectedCard !== null
  // A card that leaves the selected cell folds: put back there (an undo),
  // it is not open again.
  useEffect(() => {
    if (selectedCard === null) setOpen(false)
  }, [selectedCard])
  useEffect(() => {
    if (p.openRequest > 0) setOpen(true)
  }, [p.openRequest])
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
            draggable={cell.card !== null}
            onClick={() => {
              select(cell.index)
              setOpen(cell.card !== null)
            }}
            onDragStart={e => {
              if (cell.card !== null) dragCard(e, cell.card.id)
            }}
            type="button"
          >
            {cell.thread !== null ? (
              <ThreadFaceView face={cell.thread} />
            ) : (
              cell.face !== null && (
                <CardFace
                  colorOf={p.colorOf}
                  face={cell.face}
                  reader={p.reader}
                />
              )
            )}
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
