// client/pinned-strip — a thread's pinned cards, at the top of its column
// (ADR-0048 step 5): what the thread is for, which the agent reads on every
// run. Drawn under the column's header, outside its scrolling body, so it
// stays in view. Empty, it is a drop zone that pins the first card, shown
// only while a card is dragged (`data-card-drag`): an empty strip that took
// room would move where a column shown again puts its reader. So "+ pin" is
// in the column's header until the strip has a card (`newPinAt`), and in the
// strip after; the box it opens is drawn last in the strip.

import type { CardRecord, PinnedView } from "@pineta/core"
import type { ReactElement } from "react"
import type { ReadOnly } from "./app-view.ts"
import { PinnedCardEditor } from "./card-editor.tsx"
import { NEW_PIN, NEW_PIN_TITLE, PINNED_EMPTY } from "./card-words.ts"
import type { ColumnAct } from "./intent.ts"
import { dropProps } from "./put-target.ts"
import type { Reader } from "./send.ts"
import type { SessionClient } from "./session-view.ts"

export function PinnedStrip(p: {
  session: SessionClient
  /**
   * The thread's pinned cards, in order (`cardsAt`), but the one the open
   * box shows.
   */
  cards: readonly CardRecord[]
  /** What the agent reads of them now (`pinnedInView` at the thread's end). */
  inView: PinnedView | null
  /** The column's key, where a drop pins; null for a column that cannot be written. */
  putKey: string | null
  /** The box "+ pin" opened, drawn last; null while none is open. */
  box: ReactElement | null
  /** The strip's own "+ pin", when it offers it (`newPinAt`). */
  onNewPin: (() => void) | null
  reader: Reader
  readOnly: ReadOnly | null
  onAct: (act: ColumnAct) => void
  onTyping: () => void
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
          card={c}
          inView={p.inView}
          key={c.id}
          onAct={p.onAct}
          onTyping={p.onTyping}
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
