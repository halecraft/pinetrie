// web/inventory-panel — your inventory: a panel that floats over the columns,
// docked left, centre or right by this device's choice, in a frame that never
// changes size. Its header holds its count, the clipboard chip and
// ×; under it the bag, a grid two compact slots wide (`CardGrid`), and the
// bench, on the side away from the dock's edge: a bar of put and trash for the
// selected slot, then its card, normal and read only, or full and editable
// once opened, closed by its ×; under them one status line. It is always drawn, hidden while closed, so it can grow from its toggle
// and shrink back into it. What it draws is `inventoryView`; whether it is
// shown, the selection and the bench are `InventoryState`; every click and
// drop here is an intent, planned like any other.

import {
  type CardRecord,
  isTextCard,
  type MediaId,
  type NoteColumnId,
  type ThreadId,
  type ThreadName,
  type TitledCardId,
  type WriterId,
} from "@pinetrie/core"
import {
  type CardTitleRecord,
  CLOSE_INVENTORY,
  type ClipboardCellView,
  type DrawnCard,
  emptyBenchWords,
  INVENTORY,
  type Intent,
  type InventoryAct,
  type InventoryState,
  inventoryCountWords,
  inventoryView,
  isInventoryShown,
  type MediaColumnView,
  type NoteColumnView,
  noticeWords,
  type Reader,
  SAVE,
  SAVE_TITLE,
  type ThreadGlance,
  type ThreadPreview,
  TRASH_SELECTED,
} from "@pinetrie/interface"
import {
  AT_INVENTORY,
  type CardNotice,
  type Intents,
  type SessionClient,
  type Slots,
} from "@pinetrie/session"
import { type Dock, snappedDock } from "@pinetrie/web-core"
import {
  type CSSProperties,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button, IconButton } from "./button.tsx"
import { CardGrid } from "./card-grid.tsx"
import { CopyIcon, InventoryIcon, TrashIcon } from "./icons.tsx"
import { DrawCard, PutButton, RenderingProvider } from "./renderings.tsx"
import { useCardTexts } from "./use-card-texts.ts"

/** The side of the bag the bench is drawn on: away from the dock's edge. */
const BENCH_SIDE: Readonly<Record<Dock, "left" | "right">> = {
  left: "right",
  centre: "right",
  right: "left",
}

/** What a press on the header's own controls is: not the start of a dock's drag. */
const NOT_A_HANDLE = "button, .clipboard-cell"

/** The toggles the panel grows from: the footer's, or the account menu's. */
const TOGGLE = "#bottom .inventory-toggle, .account-inventory"

export function InventoryPanel(p: {
  session: SessionClient
  /** Every card your inventory holds, as drawn. */
  held: readonly DrawnCard[]
  slots: Slots
  intents: Intents
  /** Shown or not, the selected slot, and whether the bench has its card open. */
  state: InventoryState
  dock: Dock
  onDock: (dock: Dock) => void
  notices: readonly CardNotice[]
  reader: Reader
  colorOf: (writer: WriterId) => string
  /** The column a put lands in: the one last focused, if any. */
  column: string | null
  onIntent: (intent: Intent) => void
  /** Each held thread's glance, and its preview when opened. */
  threads: ReadonlyMap<ThreadId, ThreadGlance>
  previewOf: (thread: ThreadId) => ThreadPreview
  /** Each note column, as its column draws it. */
  notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each media column, as its column draws it. */
  media: ReadonlyMap<MediaId, MediaColumnView>
  /** Each titled card's title. */
  titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** Each thread's name, which a reference names. */
  threadNames: ReadonlyMap<ThreadId, ThreadName>
  /** The clipboard chip: the last copy this tab made, or none yet. */
  cell: ClipboardCellView | null
}) {
  const texts = useCardTexts(
    p.session,
    p.held.filter(isTextCard).map(c => c.id),
  )
  const shown = isInventoryShown(p.state)
  const view = inventoryView({
    held: p.held,
    slots: p.slots,
    intents: p.intents,
    selected: p.state.selected,
    me: p.reader.me,
    texts,
    threads: p.threads,
    threadNames: p.threadNames,
    media: p.media,
    titles: p.titles,
    open: p.state.bench === "open",
  })
  const { session, reader, colorOf, previewOf, notes, column, onIntent } = p
  const { threadNames, media, titles } = p
  const frame = useRef<HTMLElement>(null)
  const bench = useRef<HTMLDivElement>(null)
  // Folded by Escape or the open card's ×, focus goes back to its slot.
  const escaped = useRef(false)
  const context = useMemo(
    () => ({
      session,
      reader,
      colorOf,
      previewOf,
      notes,
      media,
      titles,
      threadNames,
      column,
      onIntent,
      onClose: () => {
        escaped.current = true
        onIntent({ kind: "inventory", act: { kind: "fold" } })
      },
    }),
    [
      session,
      reader,
      colorOf,
      previewOf,
      notes,
      media,
      titles,
      threadNames,
      column,
      onIntent,
    ],
  )
  const act = (a: InventoryAct) => onIntent({ kind: "inventory", act: a })
  const trash = (card: CardRecord) =>
    onIntent({ kind: "trash", card: card.id, at: AT_INVENTORY })
  // Shown, it grows from the toggle: its origin is the toggle's centre in
  // the panel's laid-out box, which no transform moves (`offsetLeft`). Read
  // before the first frame is painted, so that frame grows from there.
  useLayoutEffect(() => {
    const panel = frame.current
    if (!shown || panel === null) return
    const toggle = document.querySelector<HTMLElement>(TOGGLE)
    const box = toggle?.getBoundingClientRect()
    if (box === undefined || box.width === 0) {
      panel.style.removeProperty("--origin-x")
      panel.style.removeProperty("--origin-y")
      return
    }
    panel.style.setProperty(
      "--origin-x",
      `${box.left + box.width / 2 - panel.offsetLeft}px`,
    )
    panel.style.setProperty(
      "--origin-y",
      `${box.top + box.height / 2 - panel.offsetTop}px`,
    )
  }, [shown])
  // Opened on the bench, its card takes focus: the caret in its box, or its
  // first control for a kind with none. Folded by Escape, focus goes back to
  // its slot, where the grid's keys are; a card that left the bench (put,
  // dropped, trashed) moves no focus, or it would take focus from where
  // the person went.
  const benchOpen = view.bench.kind === "card" && view.bench.detail === "full"
  const benchCard = view.bench.kind === "card" ? view.bench.card : null
  const trashable =
    view.grid.cells[view.grid.selected]?.trashes === true && benchCard !== null
  const selected = p.state.selected
  useLayoutEffect(() => {
    const at = bench.current
    if (benchOpen) {
      const box = at?.querySelector<HTMLElement>(
        "textarea, [contenteditable='true']",
      )
      const control = at?.querySelector<HTMLElement>("button:not(:disabled)")
      ;(box ?? control ?? at)?.focus()
    } else if (escaped.current)
      frame.current
        ?.querySelector<HTMLElement>(`.slot[data-slot="${selected}"]`)
        ?.focus()
    escaped.current = false
  }, [benchOpen, selected])
  // Opened on a slot whose card left it, the bench folds: a card put there
  // later is shown normal, not opened.
  const benchState = p.state.bench
  const cardHere = view.grid.card !== null
  useLayoutEffect(() => {
    if (benchState === "open" && !cardHere)
      onIntent({ kind: "inventory", act: { kind: "select", slot: selected } })
  }, [benchState, cardHere, selected, onIntent])
  // Dragged by its header, it follows the pointer, then settles at the
  // nearest third.
  const [shift, setShift] = useState<number | null>(null)
  const from = useRef(0)
  const notice = p.notices.at(-1)
  return (
    <aside
      aria-hidden={!shown || undefined}
      aria-label={INVENTORY}
      className="inventory"
      data-bench={benchOpen ? "open" : "normal"}
      data-dock={p.dock}
      // Who opened it, for the browser suite: "peek", "held" or "refusal".
      data-shown={shown ? p.state.shown.kind : undefined}
      onFocus={() => act({ kind: "engage" })}
      onKeyDownCapture={e => {
        if (e.key === "Escape" && benchOpen) escaped.current = true
      }}
      // A pointer moved over it engages it; one it opened under, still,
      // does not (the browser sends a move then too, with no movement).
      onPointerMove={e => {
        if (e.movementX !== 0 || e.movementY !== 0) act({ kind: "engage" })
      }}
      ref={frame}
      // Your colour: a card in your inventory is drawn in it (`--you`).
      style={
        {
          "--you": p.colorOf(p.reader.me),
          "--rows": view.grid.rows,
          ...(shift === null ? {} : { translate: `${shift}px 0` }),
        } as CSSProperties
      }
    >
      <header
        className="inventory-header"
        onPointerDown={e => {
          if (e.button !== 0) return
          if ((e.target as Element).closest(NOT_A_HANDLE) !== null) return
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
          p.onDock(snappedDock(centre, window.innerWidth))
        }}
        title="drag to dock left, centre or right"
      >
        <span className="inventory-title">
          {INVENTORY} · {inventoryCountWords(view.held)}
        </span>
        {p.cell !== null && (
          <ClipboardChip
            cell={p.cell}
            onSave={() => onIntent({ kind: "save" })}
          />
        )}
        <IconButton
          label={CLOSE_INVENTORY.title}
          className="inventory-close"
          onClick={() => act({ kind: "close" })}
        >
          {CLOSE_INVENTORY.label}
        </IconButton>
      </header>
      <RenderingProvider context={context}>
        <div className="inventory-body">
          <div className="inventory-bag">
            <CardGrid
              onTrash={trash}
              onMove={(card, slot) =>
                onIntent({
                  kind: "put",
                  source: { kind: "card", card: card.id },
                  target: { kind: "inventory", slot },
                  how: "move",
                })
              }
              onOpen={() => act({ kind: "open" })}
              onSelect={slot => act({ kind: "select", slot })}
              targetOf={slot => ({ kind: "inventory", slot })}
              view={view.grid}
            />
          </div>
          <div className="bench" data-side={BENCH_SIDE[p.dock]}>
            {/* Always drawn, its buttons disabled for an empty slot, so the
            bench keeps its height. */}
            <div className="bench-bar">
              <PutButton card={benchCard} />
              <Button
                look="outline"
                aria-label={TRASH_SELECTED.title}
                className="trash-selected"
                disabled={!trashable}
                onClick={() => {
                  if (benchCard !== null && trashable) trash(benchCard)
                }}
                title={TRASH_SELECTED.title}
              >
                <TrashIcon /> {TRASH_SELECTED.label}
              </Button>
            </div>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: Enter opens it from its slot */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a click on it opens its card, as Enter does */}
            <div
              className="bench-card"
              onClick={() => {
                // A click that ends a text selection selects; it opens nothing.
                if (
                  view.bench.kind === "card" &&
                  !benchOpen &&
                  (getSelection()?.isCollapsed ?? true)
                )
                  act({ kind: "open" })
              }}
              ref={bench}
              tabIndex={-1}
            >
              {view.bench.kind === "empty" ? (
                <div className="bench-empty">
                  {emptyBenchWords(view.bench.slot)}
                </div>
              ) : (
                <DrawCard
                  card={view.bench.card}
                  detail={view.bench.detail}
                  key={view.bench.card.id}
                  width={1}
                />
              )}
            </div>
          </div>
        </div>
      </RenderingProvider>
      <div aria-live="polite" className="inventory-status">
        {notice !== undefined && noticeWords(notice, p.reader)}
      </div>
    </aside>
  )
}

/**
 * The clipboard chip, in the header: never a slot and no drop target. It is
 * focusable, so Cmd+C on it copies its copy again; **save** pastes it into a
 * free slot.
 */
function ClipboardChip(p: { cell: ClipboardCellView; onSave: () => void }) {
  const { cell } = p
  return (
    <section
      aria-label={cell.words}
      className="clipboard-cell"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus here is what Cmd+C copies
      tabIndex={0}
      title={cell.title}
    >
      <CopyIcon />
      <span className="clipboard-cell-what">{cell.summary.words}</span>
      <span className="clipboard-cell-line">{cell.summary.line}</span>
      <Button
        look="primary"
        className="save"
        disabled={!cell.save}
        onClick={p.onSave}
        title={SAVE_TITLE}
      >
        <InventoryIcon way="take" /> {SAVE}
      </Button>
    </section>
  )
}
