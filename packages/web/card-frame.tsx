// web/card-frame — the frame every text card is drawn in: a header that is its
// drag handle and its signals (its kind's icon, its place, state, who put it
// there, a command's chip, ⋯ and ×), its body, and a footer of ↑ ↓ and its one
// primary action. What it shows is `cardFrame`'s value, in `cardFrameWords`'s
// words; the frame's colour is the place's, the icon the kind's. A card's face
// is `RENDERINGS`'s (`renderings.tsx`).
//
// The body is the caller's, and keeps its elements while the card comes
// into being: the composer's box must stay one element for its whole life
// (`card-editor.tsx`), so the frame's wrappers are the same with a card and
// without one, and only the header's contents change.

import { isTextCard, type WriterId } from "@pinetrie/core"
import {
  type CardFrameView,
  type CatchUps,
  CLEAR_COMMAND,
  type ColumnAct,
  cardFrameWords,
  DISCARD_CARD,
  DISCARD_CARD_TITLE,
  type DrawnCard,
  dragProps,
  HISTORY_TITLE,
  historyItemWords,
  KIND_ICON,
  moveKey,
  moveWords,
  type Reader,
} from "@pinetrie/interface"
import { type ReactNode, useState } from "react"
import { CardHistory, MovedBack } from "./card-history.tsx"
import { InventoryIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

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
  card: DrawnCard | null
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
          // Take has one icon wherever it is offered.
          label:
            m.to === "inventory" ? (
              <>
                <InventoryIcon way="take" /> {w.label}
              </>
            ) : (
              w.label
            ),
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
      <div
        className="card-head"
        data-card={card?.id}
        // The card itself takes focus here, outside its text box, so Cmd+C
        // and Cmd+X copy and cut the card; a click focuses it. It is the
        // card's drag handle too, a card you may discard being one you may
        // move (`use-drag.ts`).
        tabIndex={card === null ? undefined : 0}
        {...(card !== null && view.discards
          ? dragProps({ kind: "card", card: card.id })
          : {})}
      >
        <span aria-hidden className="card-icon">
          {KIND_ICON[card?.kind ?? "text"]}
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
        {history && card !== null && isTextCard(card) && (
          <CardHistory card={card.id} />
        )}
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

/** A card's ×: discards it, and the undo key outside a box brings it back. */
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
