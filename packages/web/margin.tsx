// web/margin — an entry's or an image's margin, open under it: its comments, each a note
// anyone on the canvas may edit, and a control to add one. Shut, the margin is
// the count beside the entry (`MarginCount`). What it says is
// `@pinetrie/interface`'s (`margin.ts`).

import type { CardId } from "@pinetrie/core"
import {
  addCommentWords,
  type ColumnAct,
  type MarginBeside,
  type MarginCard,
  marginCountWords,
  type Reader,
  type ReadOnly,
  type SeatRecord,
  shutMarginWords,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { Button } from "./button.tsx"
import { NoteCardEditor } from "./card-editor.tsx"
import { RENDERINGS } from "./renderings.tsx"

/** A shut margin: how many comments it holds; a press opens it. */
export function MarginCount(p: {
  count: number
  beside: MarginBeside
  onOpen: () => void
}) {
  const words = marginCountWords(p.count, p.beside)
  return (
    <Button
      look="plain"
      aria-label={words.title}
      className="margin-count"
      onClick={p.onOpen}
      title={words.title}
    >
      {words.label}
    </Button>
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
  beside: MarginBeside
  /** A comment's note of the version it was written on; null for none. */
  versionOf?: (seen: string) => string | null
}) {
  const add = addCommentWords(p.beside)
  const shut = shutMarginWords(p.beside)
  return (
    <div className="margin">
      {p.comments.map(c => (
        <div className="margin-card" key={c.id}>
          {p.versionOf?.(c.place.seen) != null && (
            <div className="margin-version">{p.versionOf(c.place.seen)}</div>
          )}
          {c.kind === "text" ? (
            <NoteCardEditor
              among={p.comments}
              card={c}
              latestSources={null}
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
          <Button
            look="plain"
            className="add-comment"
            onClick={p.onComment}
            title={add.title}
          >
            {add.label}
          </Button>
        )}
        <Button
          look="plain"
          className="shut-margin"
          onClick={p.onShut}
          title={shut.title}
        >
          {shut.label}
        </Button>
      </div>
    </div>
  )
}
