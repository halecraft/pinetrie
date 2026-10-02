// client/inventory-panel — your inventory (ADR-0048 step 4): a panel that
// floats over the columns, docked left, centre or right by this device's
// choice, holding a fixed 3 × 6 grid of slots and, beside it, the selected
// card whole and editable. What it draws is `inventoryView`; every click and
// drop here is an intent, planned like any other.

import { subscribe } from "@kyneta/schema"
import type { CardId, CardRecord, WriterId } from "@pineta/core"
import { displayName } from "@pineta/marginalia"
import { useEffect, useRef, useState } from "react"
import { BoundCardEditor, dragCard } from "./card-editor.tsx"
import type { Refusal } from "./card-moves.ts"
import {
  INVENTORY,
  PUT,
  PUT_TITLE,
  REMOVE,
  refusalKey,
  refusalWords,
} from "./card-words.ts"
import type { Intent } from "./intent.ts"
import { type Intents, inventoryView, type Slots } from "./inventory.ts"
import { type Dock, snapTo } from "./inventory-dock.ts"
import { datasetOf } from "./put-target.ts"
import type { Reader } from "./send.ts"
import type { SessionClient } from "./session-view.ts"

/** The `data-*` attributes `datasetOf` gives, as React props. */
const dataProps = (dataset: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(dataset).map(([k, v]) => [
      `data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`,
      v,
    ]),
  )

/**
 * The text of each card in `ids`, read from its document and kept current.
 * A card's text arrives after its record, so one not yet read is "".
 */
function useCardTexts(
  session: Pick<SessionClient, "cardText">,
  ids: readonly CardId[],
): ReadonlyMap<CardId, string> {
  const [texts, setTexts] = useState<ReadonlyMap<CardId, string>>(new Map())
  const key = ids.join(" ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, not the array
  useEffect(() => {
    const stops = ids.map(id => {
      const doc = session.cardText(id)
      const read = () =>
        setTexts(prev =>
          prev.get(id) === doc.text()
            ? prev
            : new Map(prev).set(id, doc.text()),
        )
      read()
      return subscribe(doc, read)
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [key, session])
  return texts
}

export function InventoryPanel(p: {
  session: SessionClient
  /** Every card your inventory holds, as drawn. */
  held: readonly CardRecord[]
  slots: Slots
  intents: Intents
  selected: number
  dock: Dock
  onDock: (dock: Dock) => void
  refusals: readonly Refusal[]
  reader: Reader
  colorOf: (writer: WriterId) => string
  /** The column a put lands in: the one last focused, if any. */
  column: string | null
  onIntent: (intent: Intent) => void
}) {
  const texts = useCardTexts(
    p.session,
    p.held.map(c => c.id),
  )
  const view = inventoryView({
    held: p.held,
    slots: p.slots,
    intents: p.intents,
    selected: p.selected,
    texts,
  })
  const selected = view.card
  const frame = useRef<HTMLElement>(null)
  // Dragged by its frame, it follows the pointer, then settles at the
  // nearest third.
  const [shift, setShift] = useState<number | null>(null)
  const from = useRef(0)
  return (
    <aside
      aria-label={INVENTORY}
      className="inventory"
      data-dock={p.dock}
      ref={frame}
      style={shift === null ? undefined : { translate: `${shift}px 0` }}
    >
      <div
        className="inventory-frame"
        onPointerDown={e => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          from.current = e.clientX
          setShift(0)
        }}
        onPointerMove={e => {
          if (shift !== null) setShift(e.clientX - from.current)
        }}
        onPointerUp={e => {
          if (shift === null) return
          setShift(null)
          const box = frame.current?.getBoundingClientRect()
          const centre =
            box === undefined ? e.clientX : box.left + box.width / 2
          p.onDock(snapTo(centre, window.innerWidth))
        }}
        title="drag to dock left, centre or right"
      >
        {INVENTORY} · {view.slots.length - view.free}/{view.slots.length}
      </div>
      <div className="inventory-body">
        <div className="inventory-grid">
          {view.slots.map(slot => (
            <button
              aria-pressed={slot.selected}
              className={slot.card === null ? "slot empty" : "slot"}
              data-card={slot.card?.id}
              data-slot={slot.index}
              {...dataProps(datasetOf({ kind: "inventory", slot: slot.index }))}
              draggable={slot.card !== null}
              key={slot.index}
              onClick={() =>
                p.onIntent({ kind: "selectSlot", slot: slot.index })
              }
              onDragStart={e => {
                if (slot.card !== null) dragCard(e, slot.card.id)
              }}
              style={
                slot.card === null
                  ? undefined
                  : { borderColor: p.colorOf(slot.card.owner) }
              }
              title={
                slot.card === null
                  ? undefined
                  : `${displayName(slot.card.owner, p.reader.nameOf.get(slot.card.owner))}: ${slot.firstLine}`
              }
              type="button"
            >
              {slot.label !== null && (
                <span className="slot-label">{slot.label}</span>
              )}
              <span
                className="slot-line"
                style={
                  slot.card === null
                    ? undefined
                    : { color: p.colorOf(slot.card.owner) }
                }
              >
                {slot.firstLine}
              </span>
            </button>
          ))}
        </div>
        <div className="inventory-card">
          {selected === null ? (
            <p className="inventory-empty">
              select a slot; take a card with Ctrl+Shift+I or its take button
            </p>
          ) : (
            <BoundCardEditor
              card={selected}
              className="card-editor held"
              heading={displayName(
                selected.owner,
                p.reader.nameOf.get(selected.owner),
              )}
              key={selected.id}
              onTyping={() => {}}
              queued={null}
              readOnly={false}
              rows={4}
              session={p.session}
            >
              <button
                className="put"
                disabled={p.column === null}
                onClick={() => {
                  if (p.column !== null)
                    p.onIntent({
                      kind: "put",
                      card: selected.id,
                      target: { kind: "column", key: p.column },
                    })
                }}
                title={PUT_TITLE}
                type="button"
              >
                {PUT}
              </button>
              <button
                className="remove"
                onClick={() =>
                  p.onIntent({ kind: "remove", card: selected.id })
                }
                type="button"
              >
                {REMOVE}
              </button>
            </BoundCardEditor>
          )}
          {p.refusals.map(r => (
            <div className="refused-move" key={refusalKey(r)}>
              {refusalWords(r, p.reader)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
