// web/card-frame — the frame every text card is drawn in: a header that is its
// drag handle and its signals (its kind's icon, its place, state, who put it
// there, ⋯ and ×), its body (a command's chip, then its box), and a footer of
// ↑ ↓ and its one primary action. What it shows is `cardFrame`'s value, in `cardFrameWords`'s
// words; the frame's colour is the place's, the icon the kind's. A card
// compact is `CompactCard`'s (`renderings.tsx`).
//
// The body is the caller's, and keeps its elements while the card comes
// into being: the composer's box must stay one element for its whole life
// (`card-editor.tsx`), so the frame's wrappers are the same with a card and
// without one, and only the header's contents change.

import type { WriterId } from "@pinetrie/core"
import {
  type CardFrameView,
  CLEAR_COMMAND,
  CLOSE_CARD,
  type ColumnAct,
  cardFrameWords,
  type DrawnCard,
  HISTORY_TITLE,
  historyItemWords,
  KIND_ICON,
  type LatestSources,
  moveKey,
  moveWords,
  type Reader,
  SHARE_FILE,
  TRASH_CARD_TITLE,
} from "@pinetrie/interface"
import { isTextCard } from "@pinetrie/threads"
import { dragProps } from "@pinetrie/web-core"
import { type ReactNode, useRef, useState } from "react"
import { Button, IconButton } from "./button.tsx"
import { CardHistory, MovedBack } from "./card-history.tsx"
import { fileDropProps } from "./file-drop.ts"
import { InventoryIcon, TrashIcon } from "./icons.tsx"
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
  reader: Reader
  /** What a command catches up with at its thread; null in your inventory. */
  latestSources: LatestSources | null
  /** Who has text in the card, which someone else's note names. */
  writers?: readonly WriterId[]
  /** A move chosen in its ⋯, or a ↑ or ↓. */
  onAct: (act: ColumnAct) => void
  onTrash: () => void
  /**
   * Given, the card is open on your inventory's bench: its × closes it, back
   * to read only, and its trash is the bench's, not the frame's.
   */
  onClose?: () => void
  /** The × beside a command's chip, which sends the card as a plain message; null for none. */
  onClearCommand: (() => void) | null
  /** The footer, after the tools: its primary action and quiet words. */
  foot: ReactNode
  /**
   * Files dropped on the card, or chosen with its button, shared into its
   * box (`useShareFiles`), and what it says of them; absent for a card
   * whose box is read-only.
   */
  share?: { readonly onFiles: (files: File[]) => void; readonly status: string }
  /** The body: the card's box, and what goes with it. */
  children: ReactNode
}) {
  const { view, card } = p
  const words = cardFrameWords(view, p.reader, p.latestSources, p.writers ?? [])
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
      className={`card-frame card-editor ${TONE_CLASS[view.tone]}`}
      data-command={words.command === null ? undefined : true}
      data-queued={view.tone === "queued" ? card?.id : undefined}
      data-tone={view.tone}
      {...(p.share === undefined ? {} : fileDropProps(p.share.onFiles))}
    >
      <div
        className="card-head"
        data-card={card?.id}
        // The card itself takes focus here, outside its text box, so Cmd+C
        // and Cmd+X copy and cut the card; a click focuses it. It is the
        // card's drag handle too, a card you may trash being one you may
        // move (`use-drag.ts`).
        tabIndex={card === null ? undefined : 0}
        {...(card !== null && view.trashes
          ? dragProps({ kind: "card", card: card.id })
          : {})}
      >
        <span aria-hidden className="card-icon">
          {KIND_ICON[card?.kind ?? "text"]}
        </span>
        <span className="card-place">{words.place}</span>
        {/* A narrow column cuts these short: the title keeps their words. */}
        {words.state !== null && (
          <span
            className="card-state"
            data-state={view.state.kind}
            data-status={
              view.state.kind === "pinned" ? view.state.status : undefined
            }
            title={words.state}
          >
            {words.state}
          </span>
        )}
        {words.who !== null && (
          <span className="card-by" title={words.who}>
            {words.who}
          </span>
        )}
        {card !== null && <MovedBack card={card.id} owner={card.owner} />}
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
          {p.onClose !== undefined ? (
            <IconButton
              label={CLOSE_CARD.title}
              className="close-card"
              onClick={p.onClose}
            >
              {CLOSE_CARD.label}
            </IconButton>
          ) : (
            view.trashes && <TrashButton onTrash={p.onTrash} />
          )}
        </span>
      </div>
      <div className="card-body">
        {/* Before the box, which must keep its place among the body's
            children while a command comes and goes. */}
        {words.command !== null && (
          <span className="card-chip" title={words.command.title}>
            {words.command.label}
            {p.onClearCommand !== null && (
              <IconButton
                label={CLEAR_COMMAND}
                className="card-command-clear"
                onClick={p.onClearCommand}
              >
                ×
              </IconButton>
            )}
          </span>
        )}
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
                  <IconButton
                    look="primary"
                    label={w.title}
                    className={w.className}
                    disabled={t.act === null}
                    key={t.step}
                    onClick={() => {
                      if (t.act !== null) p.onAct(t.act)
                    }}
                  >
                    {w.label}
                  </IconButton>
                )
              )
            })}
          </span>
        )}
        {p.share !== undefined && (
          <ShareFileButton onFiles={p.share.onFiles} status={p.share.status} />
        )}
        {p.foot}
      </div>
    </div>
  )
}

/** "share a file", over a hidden file input, and what the box says of its shares. */
function ShareFileButton(p: {
  onFiles: (files: File[]) => void
  status: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <span className="card-share">
      <Button
        look="primary"
        className="share-file"
        onClick={() => input.current?.click()}
      >
        {SHARE_FILE}
      </Button>
      <input
        className="share-file-input"
        hidden
        multiple
        onChange={e => {
          p.onFiles(Array.from(e.target.files ?? []))
          // The same file chosen again is a change too.
          e.target.value = ""
        }}
        ref={input}
        type="file"
      />
      {p.status !== "" && <span className="share-status">{p.status}</span>}
    </span>
  )
}

/** A card's bin: trashes it, and the undo key outside a box brings it back. */
function TrashButton(p: { onTrash: () => void }) {
  return (
    <IconButton
      label={TRASH_CARD_TITLE}
      className="trash-card"
      onClick={p.onTrash}
    >
      <TrashIcon />
    </IconButton>
  )
}
