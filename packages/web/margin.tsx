// web/margin — an entry's margin, open under it: its comments, each a note
// anyone on the canvas may edit, and a control to add one. Shut, the margin is
// the count beside the entry (`MarginCount`). What it says is
// `@pinetrie/interface`'s (`margin.ts`).

import type { CardId } from "@pinetrie/core"
import {
  ADD_COMMENT,
  type ColumnAct,
  marginCountWords,
  type Reader,
  type ReadOnly,
  SHUT_MARGIN,
} from "@pinetrie/interface"
import type { MarginCard, SeatRecord } from "@pinetrie/rules"
import type { SessionClient } from "@pinetrie/session"
import { NoteCardEditor } from "./card-editor.tsx"
import { RENDERINGS } from "./renderings.tsx"

/** A shut margin: how many comments it holds; a press opens it. */
export function MarginCount(p: { count: number; onOpen: () => void }) {
  const words = marginCountWords(p.count)
  return (
    <button
      aria-label={words.title}
      className="margin-count"
      onClick={p.onOpen}
      title={words.title}
      type="button"
    >
      {words.label}
    </button>
  )
}

/** An open margin: its comments under its entry, normal (`DETAIL_ON`). */
export function Margin(p: {
  comments: readonly MarginCard[]
  session: SessionClient
  reader: Reader
  readOnly: ReadOnly | null
  seats: readonly SeatRecord[]
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
  onComment: () => void
  onShut: () => void
}) {
  return (
    <div className="margin">
      {p.comments.map(c => (
        <div className="margin-card" key={c.id}>
          {c.kind === "text" ? (
            <NoteCardEditor
              among={p.comments}
              card={c}
              catchUps={null}
              onAct={p.onAct}
              onTyping={p.onTyping}
              readOnly={p.readOnly}
              reader={p.reader}
              seats={p.seats}
              session={p.session}
            />
          ) : (
            <RENDERINGS.reference.Normal card={c} width={1} />
          )}
        </div>
      ))}
      <div className="margin-foot">
        {p.readOnly === null && (
          <button
            className="add-comment"
            onClick={p.onComment}
            title={ADD_COMMENT.title}
            type="button"
          >
            {ADD_COMMENT.label}
          </button>
        )}
        <button
          className="shut-margin"
          onClick={p.onShut}
          title={SHUT_MARGIN.title}
          type="button"
        >
          {SHUT_MARGIN.label}
        </button>
      </div>
    </div>
  )
}
