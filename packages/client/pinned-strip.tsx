// client/pinned-strip — a thread's pinned cards, at the top of its column
// (ADR-0048 step 5): what the thread is for, which the agent reads on every
// run. Drawn under the column's header, outside its scrolling body, so it
// stays in view. Empty, it is a drop zone that pins the first card, shown
// only while a card is dragged (`data-card-drag`): an empty strip that took
// room would move where a column shown again puts its reader.

import type { CardRecord, PinnedView } from "@pineta/core"
import type { ReadOnly } from "./app-view.ts"
import { PinnedCardEditor } from "./card-editor.tsx"
import { PINNED_EMPTY } from "./card-words.ts"
import type { ColumnAct } from "./intent.ts"
import { dropProps } from "./put-target.ts"
import type { Reader } from "./send.ts"
import type { SessionClient } from "./session-view.ts"

export function PinnedStrip(p: {
  session: SessionClient
  /** The thread's pinned cards, in order (`cardsAt`). */
  cards: readonly CardRecord[]
  /** What the agent reads of them now (`pinnedInView` at the thread's end). */
  inView: PinnedView | null
  /** The column's key, where a drop pins; null for a column that cannot be written. */
  putKey: string | null
  reader: Reader
  readOnly: ReadOnly | null
  onAct: (act: ColumnAct) => void
  onTyping: () => void
}) {
  if (p.cards.length === 0 && p.putKey === null) return null
  return (
    <div
      className="pinned-strip"
      data-empty={p.cards.length === 0 || undefined}
      {...(p.putKey === null
        ? {}
        : dropProps({ kind: "pinned", key: p.putKey }))}
    >
      {p.cards.length === 0 ? (
        <span className="pinned-empty">{PINNED_EMPTY}</span>
      ) : (
        p.cards.map(c => (
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
        ))
      )}
    </div>
  )
}
