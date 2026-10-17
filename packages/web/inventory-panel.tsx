// web/inventory-panel — your inventory: a panel that floats over the columns,
// docked left, centre or right by this device's choice, holding a fixed 3 × 6
// grid of slots (`CardGrid`). The selected card is previewed beside the grid,
// normal, one column wide and read only, on the side away from the panel's dock
// edge; Enter opens it whole and editable in place, and the preview hides while
// it is open. What it draws is `inventoryView`, each card by its kind's row of
// `RENDERINGS`; every click and drop here is an intent, planned like any other.

import {
  isTextCard,
  type NoteColumnId,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type ClipboardCellView,
  type Dock,
  type DrawnCard,
  INVENTORY,
  type Intent,
  inventoryView,
  KEEP,
  KEEP_TITLE,
  type NoteColumnView,
  noticeKey,
  noticeWords,
  type Reader,
  snapTo,
  type ThreadFace,
  type ThreadPreview,
} from "@pinetrie/interface"
import {
  AT_INVENTORY,
  type CardNotice,
  type Intents,
  type SessionClient,
  type Slots,
} from "@pinetrie/session"
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { CardGrid } from "./card-grid.tsx"
import { CopyIcon, InventoryIcon } from "./icons.tsx"
import { DrawCard, RenderingProvider } from "./renderings.tsx"
import { useCardTexts } from "./use-card-texts.ts"

/** The side of the grid the preview is drawn on: away from the dock's edge. */
const PREVIEW_SIDE: Readonly<Record<Dock, "left" | "right">> = {
  left: "right",
  centre: "right",
  right: "left",
}

export function InventoryPanel(p: {
  session: SessionClient
  /** Every card your inventory holds, as drawn. */
  held: readonly DrawnCard[]
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
  /** Each held thread's face, and its preview when opened. */
  threads: ReadonlyMap<ThreadId, ThreadFace>
  previewOf: (thread: ThreadId) => ThreadPreview
  /** Each note column, as its column draws it. */
  notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each thread's name, which a reference names. */
  threadNames: ReadonlyMap<ThreadId, ThreadName>
  /** The clipboard cell: the last copy this tab made, or none yet. */
  cell: ClipboardCellView | null
}) {
  const texts = useCardTexts(
    p.session,
    p.held.filter(isTextCard).map(c => c.id),
  )
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (p.openRequest > 0) setOpen(true)
  }, [p.openRequest])
  const view = inventoryView({
    held: p.held,
    slots: p.slots,
    intents: p.intents,
    selected: p.selected,
    me: p.reader.me,
    texts,
    threads: p.threads,
    open,
  })
  const { session, reader, colorOf, previewOf, notes, column, onIntent } = p
  const { threadNames } = p
  const context = useMemo(
    () => ({
      session,
      reader,
      colorOf,
      previewOf,
      notes,
      threadNames,
      column,
      onIntent,
      onClose: null,
    }),
    [session, reader, colorOf, previewOf, notes, threadNames, column, onIntent],
  )
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
      // Your colour: a card in your inventory is drawn in it (`--you`).
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
        <RenderingProvider context={context}>
          <div className="inventory-grid-row">
            <CardGrid
              onMove={(card, slot) =>
                p.onIntent({
                  kind: "put",
                  source: { kind: "card", card: card.id },
                  target: { kind: "inventory", slot },
                  how: "move",
                })
              }
              onDiscard={card =>
                p.onIntent({ kind: "discard", card: card.id, at: AT_INVENTORY })
              }
              onOpen={setOpen}
              onSelect={slot => p.onIntent({ kind: "selectSlot", slot })}
              open={open}
              renderOpen={(card: DrawnCard, fold) => (
                <RenderingProvider context={{ ...context, onClose: fold }}>
                  <DrawCard card={card} detail="whole" width={1} />
                </RenderingProvider>
              )}
              targetOf={slot => ({ kind: "inventory", slot })}
              view={view.grid}
            />
            {p.cell !== null && (
              <ClipboardCell
                cell={p.cell}
                onKeep={() => p.onIntent({ kind: "keep" })}
                side={PREVIEW_SIDE[p.dock] === "right" ? "left" : "right"}
              />
            )}
            {view.preview !== null && (
              <div
                className="preview"
                data-side={PREVIEW_SIDE[p.dock]}
                key={view.preview.card.id}
              >
                <DrawCard
                  card={view.preview.card}
                  detail={view.preview.detail}
                  width={view.preview.width}
                />
              </div>
            )}
          </div>
        </RenderingProvider>
        {p.notices.map(r => (
          <div className="refused-move" key={noticeKey(r)}>
            {noticeWords(r, p.reader)}
          </div>
        ))}
      </div>
    </aside>
  )
}

/**
 * The clipboard cell: beside the grid, on the side away from the preview, never
 * a slot and no drop target. It is focusable, so Cmd+C on it copies its copy
 * again; **keep** pastes it into a free slot.
 */
function ClipboardCell(p: {
  cell: ClipboardCellView
  onKeep: () => void
  side: "left" | "right"
}) {
  const { cell } = p
  return (
    <section
      aria-label={cell.words}
      className="clipboard-cell"
      data-side={p.side}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus here is what Cmd+C copies
      tabIndex={0}
      title={cell.title}
    >
      <div className="clipboard-cell-head">
        <CopyIcon /> {cell.words}
      </div>
      <div className="clipboard-cell-face">
        <span className="clipboard-cell-what">{cell.face.words}</span>
        <span className="clipboard-cell-line">{cell.face.line}</span>
      </div>
      <button
        className="keep"
        disabled={!cell.keep}
        onClick={p.onKeep}
        title={KEEP_TITLE}
        type="button"
      >
        <InventoryIcon way="take" /> {KEEP}
      </button>
    </section>
  )
}
