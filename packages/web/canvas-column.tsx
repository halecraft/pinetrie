// web/canvas-column — the canvas column: the canvas's own place on its canvas,
// drawn before every card and outside the order, so nothing moves it. Its
// title is renamed in place, its state changed from its Move to ▸, the same
// intents the sidebar and the board send; who is here is the board's
// readers. Its fold toggle comes first, folded or not, as a card column's
// does. Folded, it is a `FoldedStrip` with its title, and no mark or box.
// What it says is `canvasColumnView`'s.

import type {
  CanvasId,
  CanvasPinnedView,
  CardId,
  EntryId,
  TextCard,
} from "@pinetrie/core"
import {
  boardPlaceWords,
  CANVAS_BUSY_REASON,
  CANVAS_LIST_HEADING,
  CANVAS_PINS_EMPTY,
  CANVAS_PINS_HEADING,
  type CanvasColumnView,
  type ColumnAct,
  dropProps,
  dropsWords,
  FOLD_CANVAS,
  type Intent,
  moveTitle,
  NO_MARK,
  pinnedCountWords,
  RENAME_CANVAS_TITLE,
  RESTORE_WORDS,
  type Reader,
  type ReadOnly,
  renameIntent,
  trashHeading,
  trashKeepWords,
  trashWords,
  UNFOLD_CANVAS,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { useState } from "react"
import { Button, IconButton } from "./button.tsx"
import { PinnedCardEditor } from "./card-editor.tsx"
import { FoldedStrip } from "./folded-strip.tsx"
import { Menu, type MenuItem } from "./menu.tsx"
import { ReaderMenus, type ReadersProps } from "./root-signals.tsx"
import { TitleField } from "./title-field.tsx"

export function CanvasColumn(p: {
  session: SessionClient
  view: CanvasColumnView
  /** The cards pinned to the canvas, in order (`canvasPinnedCards`). */
  pins: readonly TextCard[]
  /**
   * What the agent of the canvas's first column last read of them
   * (`canvasPinnedInView`), as a thread's pins are read; null for nothing yet.
   */
  pinsInView: CanvasPinnedView | null
  /** The canvas list the canvas's agents are told (`canvasList`), its lines. */
  told: readonly string[]
  reader: Reader
  readOnly: ReadOnly | null
  onTyping: (card: CardId) => void
  readers: ReadersProps
  /** A reader's menu row: one of their threads, which opens it. */
  thread: (end: EntryId, canvas: CanvasId) => MenuItem | null
  onIntent: (intent: Intent) => void
}) {
  const { view } = p
  const placeWords = boardPlaceWords(view.place)
  const [renaming, setRenaming] = useState(false)
  const fold = (unfolded: boolean) =>
    p.onIntent({ kind: "fold-canvas", unfolded })
  // A pin's acts are said in the canvas column, by its canvas's id.
  const act = (a: ColumnAct) =>
    p.onIntent({
      kind: "column",
      column: { kind: "canvas", canvas: view.canvas },
      act: a,
    })
  if (view.folded)
    return (
      <section
        className="canvas-column folded-column"
        data-canvas={view.canvas}
      >
        <FoldedStrip
          detail={pinnedCountWords(p.pins.length)}
          dot={null}
          hint={null}
          mark={NO_MARK}
          name={view.label}
          onUnfold={() => fold(true)}
          start={
            <IconButton
              label={UNFOLD_CANVAS.title}
              className={UNFOLD_CANVAS.className}
              onClick={() => fold(true)}
            >
              {UNFOLD_CANVAS.label}
            </IconButton>
          }
          unfold={UNFOLD_CANVAS}
        />
      </section>
    )
  return (
    <section className="canvas-column" data-canvas={view.canvas}>
      <header className="canvas-column-head">
        <IconButton
          label={FOLD_CANVAS.title}
          className={FOLD_CANVAS.className}
          onClick={() => fold(false)}
        >
          {FOLD_CANVAS.label}
        </IconButton>
        {renaming && !view.readOnly ? (
          <TitleField
            label="title for this canvas"
            onEnd={() => setRenaming(false)}
            onSend={title => p.onIntent(renameIntent(view.canvas, title))}
            placeholder={view.placeholder}
            stored={view.titled}
          />
        ) : (
          <Button
            look="plain"
            className="canvas-column-title"
            disabled={view.readOnly}
            onClick={() => setRenaming(true)}
            title={RENAME_CANVAS_TITLE}
          >
            <span data-fold-name="">{view.label}</span>
          </Button>
        )}
      </header>
      <div className="canvas-column-body">
        <div className="canvas-state">
          <span className="canvas-state-name">{placeWords.line}</span>
          {view.moves.length > 0 && (
            <Menu
              className="canvas-state-menu"
              label={placeWords.moveLabel}
              sections={[
                {
                  key: "moves",
                  items: view.moves.map(m => {
                    const drops = m.busy === null ? dropsWords(m.drops) : null
                    return {
                      key: m.name,
                      className: m.closes ? "move-to closes" : "move-to",
                      disabled: m.busy !== null,
                      title: moveTitle(m),
                      label: (
                        <>
                          Move to {m.name}
                          {m.busy !== null && (
                            <span className="why">
                              {" "}
                              · {CANVAS_BUSY_REASON[m.busy]}
                            </span>
                          )}
                          {drops !== null && (
                            <span className="why drops"> · {drops}</span>
                          )}
                        </>
                      ),
                      onChoose: () => p.onIntent(m.intent),
                    }
                  }),
                },
              ]}
              trigger="Move to ▸"
              triggerClassName="canvas-state-move"
            />
          )}
        </div>
        <div
          className="canvas-pins"
          data-empty={p.pins.length === 0 || undefined}
          {...(view.readOnly
            ? {}
            : dropProps({ kind: "canvas-pinned", canvas: view.canvas }))}
        >
          <span className="canvas-pins-heading">{CANVAS_PINS_HEADING}</span>
          {p.pins.length === 0 && (
            <span className="pinned-empty">{CANVAS_PINS_EMPTY}</span>
          )}
          {p.pins.map(c => (
            <PinnedCardEditor
              among={p.pins}
              card={c}
              latestSources={null}
              inView={p.pinsInView}
              key={c.id}
              onAct={act}
              onTyping={p.onTyping}
              queueOn={null}
              readOnly={p.readOnly}
              reader={p.reader}
              session={p.session}
            />
          ))}
        </div>
        <details className="canvas-told">
          <summary>{CANVAS_LIST_HEADING}</summary>
          {p.told.map(line => (
            <div className="canvas-told-line" key={line}>
              {line}
            </div>
          ))}
        </details>
        {view.trash.rows.length > 0 && (
          <details className="canvas-trash">
            <summary>{trashHeading(view.trash.rows.length)}</summary>
            <p className="trash-keep">{trashKeepWords(view.trash.keepMs)}</p>
            {view.trash.rows.map(row => (
              <div
                className="trash-row"
                data-card={row.card}
                data-soon={row.deletesInMs === null ? undefined : ""}
                key={row.card}
              >
                <span className="trash-title">{row.title}</span>
                <Button
                  look="plain"
                  className="trash-restore"
                  disabled={view.readOnly}
                  onClick={() =>
                    p.onIntent({
                      kind: "restore",
                      card: row.card,
                      at: { kind: "column", key: view.canvas },
                    })
                  }
                  title={RESTORE_WORDS.title}
                >
                  {RESTORE_WORDS.label}
                </Button>
                <span className="trash-why">{trashWords(row, p.reader)}</span>
              </div>
            ))}
          </details>
        )}
        <div className="canvas-here">
          <ReaderMenus {...p.readers} canvas={view.canvas} thread={p.thread} />
        </div>
      </div>
    </section>
  )
}
