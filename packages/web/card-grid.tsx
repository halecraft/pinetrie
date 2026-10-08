// web/card-grid — a grid of cards (ADR-0048, ADR-0113): your inventory's
// slots, or a thread's notes board, drawn from a `GridView` as index cards,
// empty cells dashed. Every cell is a drop target; a card's cell starts its
// drag. Its keys are `gridKeyAct`'s: arrows and `hjkl` move the selection,
// Alt+arrows move the selected card, Enter opens it. A grid that makes cards
// (`onCreate`, a notes board's) makes one in a selected empty cell, by Enter
// or the cell's "+", and opens it with the cursor in its box. The open card is drawn
// whole and editable in place, over its neighbours, by the caller
// (`renderOpen`); Escape folds it. What a selection, a move or a drop does is
// the caller's: an intent, planned like any other.

import type { CardRecord, WriterId } from "@pinetrie/core"
import {
  dropProps,
  type GridView,
  gridKeyAct,
  NEW_NOTE_TITLE,
  type PutTarget,
  type Reader,
} from "@pinetrie/interface"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CardFace, dragCard } from "./card-frame.tsx"
import { isTextBox } from "./text-box.ts"

/** Each grid's own names: its class, and its cells' class and attribute. */
const NAMES = {
  inventory: { grid: "inventory-grid", cell: "slot", attr: "data-slot" },
  notes: { grid: "notes-grid", cell: "note-cell", attr: "data-cell" },
} as const

export function CardGrid(p: {
  view: GridView
  /** Your inventory's slots, or a notes board's cells. */
  kind: keyof typeof NAMES
  /** Where a drop on cell `n` lands. */
  targetOf: (n: number) => PutTarget
  reader: Reader
  colorOf: (writer: WriterId) => string
  onSelect: (n: number) => void
  /** The selected card to cell `to`, a card there swapping with it. */
  onMove: (card: CardRecord, to: number) => void
  /** The open card, whole: a `CardFrame` around its box. */
  renderOpen: (card: CardRecord) => ReactNode
  /** Make a new card in empty cell `n`; null for a grid that makes none. */
  onCreate: ((n: number) => void) | null
}) {
  const { view } = p
  const names = NAMES[p.kind]
  const [open, setOpen] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const selectedCard = view.card
  const shownOpen = open && selectedCard !== null
  // The cell a card was just made in: it opens there once it is drawn, its
  // box focused, and is forgotten when another cell is chosen.
  const [creating, setCreating] = useState<number | null>(null)
  // A card that leaves the selected cell folds: put back there (an undo),
  // it is not open again.
  useEffect(() => {
    if (selectedCard === null) setOpen(false)
  }, [selectedCard])
  // Once drawn it opens; once open, its box takes the focus, so you write
  // in it at once.
  const made = creating !== null && creating === view.selected
  useEffect(() => {
    if (!made || selectedCard === null) return
    if (!shownOpen) return setOpen(true)
    setCreating(null)
    grid.current
      ?.querySelector<HTMLTextAreaElement>(".card-grid-open textarea")
      ?.focus()
  }, [made, selectedCard, shownOpen])
  /** Select cell `n`, folded, and give it focus. */
  const select = (n: number) => {
    setOpen(false)
    setCreating(null)
    p.onSelect(n)
    grid.current?.querySelector<HTMLElement>(`[${names.attr}="${n}"]`)?.focus()
  }
  const create = (n: number) => {
    if (p.onCreate === null) return
    setCreating(n)
    p.onCreate(n)
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
          creates: p.onCreate !== null,
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
          case "create":
            create(view.selected)
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
            {cell.face !== null && (
              <CardFace
                colorOf={p.colorOf}
                face={cell.face}
                reader={p.reader}
              />
            )}
          </button>
          {cell.selected && cell.card === null && p.onCreate !== null && (
            <button
              aria-label={NEW_NOTE_TITLE}
              className="card-grid-new"
              onClick={() => create(cell.index)}
              title={NEW_NOTE_TITLE}
              type="button"
            >
              +
            </button>
          )}
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
