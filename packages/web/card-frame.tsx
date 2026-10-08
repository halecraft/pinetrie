// web/card-frame — the frame every text card is drawn in (ADR-0111): a
// header that is its grip and its signals (icon, place, state, who put it
// there, a command's chip, ⋯ and ×), its body, and a footer of ↑ ↓ and its
// one primary action; and its face, the card folded in a grid's cell
// (`CardFace`). What they show is `cardFrame`'s and `cardFace`'s values, in
// `cardFrameWords`'s and `cardFaceWords`'s words.
//
// The body is the caller's, and keeps its elements while the card comes
// into being: the composer's box must stay one element for its whole life
// (`card-editor.tsx`), so the frame's wrappers are the same with a card and
// without one, and only the header's contents change.

import type { CardId, CardRecord, WriterId } from "@pinetrie/core"
import {
  CARD_MIME,
  type CardFaceView,
  type CardFrameView,
  type CatchUps,
  CLEAR_COMMAND,
  type ColumnAct,
  cardFaceWords,
  cardFrameWords,
  DISCARD_CARD,
  DISCARD_CARD_TITLE,
  HISTORY_TITLE,
  historyItemWords,
  moveKey,
  moveWords,
  type Reader,
} from "@pinetrie/interface"
import { type ReactNode, useRef, useState } from "react"
import { CardHistory, MovedBack } from "./card-history.tsx"
import { Menu } from "./menu.tsx"
import { Initial } from "./presence.tsx"

/** A tone's class; the inventory's is `held`, since `.inventory` is the panel's. */
const TONE_CLASS: Readonly<Record<CardFrameView["tone"], string>> = {
  inventory: "held",
  composing: "composing",
  note: "note",
  queued: "queued",
  pinned: "pinned",
}

export function CardFrame(p: {
  view: CardFrameView
  /** The card it frames; null before the composer's or "+ pin" box's exists. */
  card: CardRecord | null
  /** The box "+ pin" opens: a pinned frame that is still being written. */
  pinning?: boolean
  reader: Reader
  /** What a command catches up with at its thread; null in your inventory. */
  catchUps: CatchUps | null
  /** Who has text in the card, which someone else's note names. */
  writers?: readonly WriterId[]
  /** A move chosen in its ⋯, or a ↑ or ↓. */
  onAct: (act: ColumnAct) => void
  onDiscard: () => void
  /** The × beside a command's chip, which sends the card as a plain message; null for none. */
  onClearCommand: (() => void) | null
  /** The footer, after the tools: its primary action and quiet words. */
  foot: ReactNode
  /** The body: the card's box, and what goes with it. */
  children: ReactNode
}) {
  const { view, card } = p
  const words = cardFrameWords(view, p.reader, p.catchUps, p.writers ?? [])
  const [history, setHistory] = useState(false)
  // A press on ⋯, ×, or the menu's items starts no drag of the card.
  const onControl = useRef(false)
  const sections = [
    {
      key: "moves",
      items: view.moves.map(m => {
        const w = moveWords(m.to)
        const key = moveKey(m.to)
        return {
          key,
          className: "move-to",
          data: { to: key },
          label: w.label,
          title: w.title,
          onChoose: () => p.onAct(m.act),
        }
      }),
    },
    {
      key: "history",
      items: [
        {
          key: "history",
          className: "card-history-item",
          label: historyItemWords(history),
          title: HISTORY_TITLE,
          onChoose: () => setHistory(open => !open),
        },
      ],
    },
  ].filter(s => s.items.length > 0)
  return (
    <div
      // The browser suite reads `.card-editor.queued`, `.pinned` and a queued
      // card's `data-queued`.
      className={`card-frame card-editor ${TONE_CLASS[view.tone]}${p.pinning === true ? " pinning" : ""}`}
      data-queued={view.tone === "queued" ? card?.id : undefined}
      data-tone={view.tone}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag handle; the keyboard moves a card through its ⋯ and Ctrl+Shift+I */}
      <div
        className="card-head"
        data-card={card?.id}
        // A card you may discard is one you may move.
        draggable={card !== null && view.discards}
        onDragStart={e => {
          if (card === null || onControl.current) return e.preventDefault()
          dragCard(e, card.id)
        }}
        onPointerDown={e => {
          onControl.current =
            e.target instanceof Element &&
            e.target.closest("button, [role='menu'], .popover") !== null
        }}
      >
        <span aria-hidden className="card-icon">
          {words.icon}
        </span>
        <span className="card-place">{words.place}</span>
        {words.state !== null && (
          <span
            className="card-state"
            data-state={view.state.kind}
            data-status={
              view.state.kind === "pinned" ? view.state.status : undefined
            }
          >
            {words.state}
          </span>
        )}
        {words.who !== null && <span className="card-by">{words.who}</span>}
        {card !== null && <MovedBack card={card.id} owner={card.owner} />}
        {words.command !== null && (
          <span className="card-chip" title={words.command.title}>
            {words.command.label}
            {p.onClearCommand !== null && (
              <button
                aria-label={CLEAR_COMMAND}
                className="card-command-clear"
                onClick={p.onClearCommand}
                title={CLEAR_COMMAND}
                type="button"
              >
                ×
              </button>
            )}
          </span>
        )}
        {/* Room kept for ⋯ and × before the card exists, so the header
            does not shift when it is created. */}
        <span className="card-head-acts">
          {card !== null && (
            <Menu
              className="card-menu"
              label="card actions"
              sections={sections}
              trigger="⋯"
              triggerClassName="card-menu-trigger"
            />
          )}
          {view.discards && <DiscardButton onDiscard={p.onDiscard} />}
        </span>
      </div>
      <div className="card-body">
        {p.children}
        {history && card !== null && <CardHistory card={card.id} />}
      </div>
      <div className="card-foot">
        {view.tools.length > 0 && (
          <span className="card-tools">
            {view.tools.map((t, i) => {
              const w = words.tools[i]
              return (
                w !== undefined && (
                  <button
                    className={w.className}
                    disabled={t.act === null}
                    key={t.step}
                    onClick={() => {
                      if (t.act !== null) p.onAct(t.act)
                    }}
                    title={w.title}
                    type="button"
                  >
                    {w.label}
                  </button>
                )
              )
            })}
          </span>
        )}
        {p.foot}
      </div>
    </div>
  )
}

/** Start a card's drag: its id, under pinetrie's own type (`put-target.ts`). */
export const dragCard = (
  e: { readonly dataTransfer: DataTransfer | null },
  card: CardId,
) => {
  e.dataTransfer?.setData(CARD_MIME, card)
  if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = "move"
}

/** A card's ×: discards it, and the undo key outside a box brings it back (ADR-0111). */
export function DiscardButton(p: { onDiscard: () => void }) {
  return (
    <button
      aria-label={DISCARD_CARD_TITLE}
      className="discard-card"
      onClick={p.onDiscard}
      title={DISCARD_CARD_TITLE}
      type="button"
    >
      {DISCARD_CARD}
    </button>
  )
}

/**
 * A card folded (ADR-0113): a strip in its place's colour, its icon, its
 * owner's circle, its command's chip, its first three lines, and its slot's
 * key in your inventory. Not an `Avatar`: the browser suite counts people
 * by `.avatar`.
 */
export function CardFace(p: {
  face: CardFaceView
  reader: Reader
  colorOf: (writer: WriterId) => string
}) {
  const { face } = p
  const words = cardFaceWords(face, p.reader)
  return (
    <span
      className="card-face"
      data-tone={face.tone}
      title={`${words.owner}: ${face.lines}`}
    >
      <span className="card-face-head">
        <span aria-hidden className="card-icon">
          {words.icon}
        </span>
        <Initial
          className="card-face-owner"
          colorOf={p.colorOf}
          nameOf={p.reader.nameOf}
          writer={face.owner}
        />
        {words.command !== null && (
          <span className="card-chip">{words.command}</span>
        )}
        {face.key !== null && <span className="card-face-key">{face.key}</span>}
      </span>
      <span className="card-face-lines">{face.lines}</span>
    </span>
  )
}
