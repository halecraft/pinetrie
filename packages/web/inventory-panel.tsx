// web/inventory-panel — your inventory (ADR-0048 step 4): a panel that
// floats over the columns, docked left, centre or right by this device's
// choice, holding a fixed 3 × 6 grid of slots (`CardGrid`, ADR-0113), the
// selected card opening whole and editable in place. What it draws is
// `inventoryView`; every click and drop here is an intent, planned like any
// other.

import {
  type CardRecord,
  isTextCard,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  cardFrame,
  type Dock,
  INVENTORY,
  type Intent,
  inventoryView,
  noticeKey,
  noticeWords,
  PUT,
  PUT_TITLE,
  type Reader,
  snapTo,
  type ThreadFace,
  type ThreadPreview,
} from "@pinetrie/interface"
import type {
  CardNotice,
  Intents,
  SessionClient,
  Slots,
} from "@pinetrie/session"
import { type CSSProperties, useRef, useState } from "react"
import { BoundCardEditor } from "./card-editor.tsx"
import { CardGrid } from "./card-grid.tsx"
import { ThreadPreviewView } from "./thread-preview.tsx"

/** A thread's put: onto the canvas you are on, after the column you were in. */
const PUT_THREAD_TITLE =
  "put this thread on the canvas you are on, after the column you were in"

import { useCardTexts } from "./use-card-texts.ts"

export function InventoryPanel(p: {
  session: SessionClient
  /** Every card your inventory holds, as drawn. */
  held: readonly CardRecord[]
  slots: Slots
  intents: Intents
  selected: number
  dock: Dock
  onDock: (dock: Dock) => void
  notices: readonly CardNotice[]
  reader: Reader
  colorOf: (writer: WriterId) => string
  /** The column a put lands in: the one last focused, if any. */
  column: string | null
  onIntent: (intent: Intent) => void
  /** Each change opens the selected slot's card (`openSelected`). */
  openRequest: number
  /** Each held thread's face, and its preview when opened (ADR-0124). */
  threads: ReadonlyMap<ThreadId, ThreadFace>
  previewOf: (thread: ThreadId) => ThreadPreview
}) {
  const texts = useCardTexts(
    p.session,
    p.held.filter(isTextCard).map(c => c.id),
  )
  const view = inventoryView({
    held: p.held,
    slots: p.slots,
    intents: p.intents,
    selected: p.selected,
    texts,
    threads: p.threads,
  })
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
      // Your colour: a card in your inventory is drawn in it (`--you`, ADR-0111).
      style={
        {
          "--you": p.colorOf(p.reader.me),
          ...(shift === null ? {} : { translate: `${shift}px 0` }),
        } as CSSProperties
      }
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
        {INVENTORY} · {view.grid.cells.length - view.free}/
        {view.grid.cells.length}
      </div>
      <div className="inventory-body">
        <CardGrid
          colorOf={p.colorOf}
          onMove={(card, slot) =>
            p.onIntent({
              kind: "put",
              card: card.id,
              target: { kind: "inventory", slot },
            })
          }
          onSelect={slot => p.onIntent({ kind: "selectSlot", slot })}
          openRequest={p.openRequest}
          reader={p.reader}
          renderOpen={card =>
            card.kind === "thread" ? (
              <ThreadPreviewView
                foot={
                  <button
                    className="put primary"
                    disabled={p.column === null}
                    onClick={() => {
                      if (p.column !== null)
                        p.onIntent({
                          kind: "put",
                          card: card.id,
                          target: { kind: "column", key: p.column },
                        })
                    }}
                    title={PUT_THREAD_TITLE}
                    type="button"
                  >
                    {PUT}
                  </button>
                }
                preview={p.previewOf(card.id)}
              />
            ) : !isTextCard(card) ? null : (
              <BoundCardEditor
                among={null}
                card={card}
                catchUps={null}
                foot={
                  <button
                    className="put primary"
                    disabled={p.column === null}
                    onClick={() => {
                      if (p.column !== null)
                        p.onIntent({
                          kind: "put",
                          card: card.id,
                          target: { kind: "column", key: p.column },
                        })
                    }}
                    title={PUT_TITLE}
                    type="button"
                  >
                    {PUT}
                  </button>
                }
                key={card.id}
                onDiscard={() => p.onIntent({ kind: "discard", card: card.id })}
                onTyping={() => {}}
                readOnly={false}
                reader={p.reader}
                rows={4}
                session={p.session}
                view={cardFrame(card, "inventory", {
                  me: p.reader.me,
                  readOnly: false,
                })}
              />
            )
          }
          targetOf={slot => ({ kind: "inventory", slot })}
          view={view.grid}
        />
        {p.notices.map(r => (
          <div className="refused-move" key={noticeKey(r)}>
            {noticeWords(r, p.reader)}
          </div>
        ))}
      </div>
    </aside>
  )
}
