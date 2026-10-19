// web/pinned-strip — a thread's pinned cards, at the top of its column: what
// the thread is for, which the agent reads on every run. Drawn under the
// column's header, outside its scrolling body, so it stays in view. Empty, it
// is a drop zone that pins the first card, shown only while a card is dragged
// (`data-card-drag`): an empty strip that took room would move where a column
// shown again puts its reader. So "+ pin" is in the column's header until the
// strip has a card (`newPinPlace`), and in the strip after; the box it opens is
// drawn last in the strip.

import type { CardId, PinnedView, TextCard } from "@pinetrie/core"
import {
  type CardFrameFacts,
  type ColumnAct,
  dropProps,
  type LatestSources,
  NEW_PIN,
  NEW_PIN_TITLE,
  PINNED_EMPTY,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import type { ReactElement } from "react"
import { PinnedCardEditor } from "./card-editor.tsx"

export function PinnedStrip(p: {
  session: SessionClient
  /**
   * The thread's pinned cards, in order (`cardsAt`), but the one the open
   * box shows.
   */
  cards: readonly TextCard[]
  /** What the agent reads of them now (`pinnedInView` at the thread's end). */
  inView: PinnedView | null
  /** The column's key, where a drop pins; null for a column that cannot be written. */
  putKey: string | null
  /** The box "+ pin" opened, drawn last; null while none is open. */
  box: ReactElement | null
  /** The strip's own "+ pin", when it offers it (`newPinPlace`). */
  onNewPin: (() => void) | null
  /** Where a queue from this column puts a card; null where nothing can be queued. */
  queueOn: CardFrameFacts["queueOn"]
  latestSources: LatestSources
  reader: Reader
  readOnly: ReadOnly | null
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId | null) => void
}) {
  const empty = p.cards.length === 0 && p.box === null
  if (empty && p.putKey === null) return null
  return (
    <div
      className="pinned-strip"
      data-empty={empty || undefined}
      {...(p.putKey === null
        ? {}
        : dropProps({ kind: "pinned", key: p.putKey }))}
    >
      {empty && <span className="pinned-empty">{PINNED_EMPTY}</span>}
      {p.cards.map(c => (
        <PinnedCardEditor
          among={p.cards}
          card={c}
          latestSources={p.latestSources}
          inView={p.inView}
          key={c.id}
          onAct={p.onAct}
          onTyping={p.onTyping}
          queueOn={p.queueOn}
          readOnly={p.readOnly}
          reader={p.reader}
          session={p.session}
        />
      ))}
      {p.box}
      {p.onNewPin !== null && (
        <button
          className="new-pin"
          onClick={p.onNewPin}
          title={NEW_PIN_TITLE}
          type="button"
        >
          {NEW_PIN}
        </button>
      )}
    </div>
  )
}
