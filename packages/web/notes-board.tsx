// web/notes-board — a thread's notes board (ADR-0113), in its column's pane:
// its notes on a card grid 4 wide and growing (`notesBoardView`), each in its
// cell, gaps kept. A drop on a cell, or Alt+arrows, puts a note there, a note
// in it swapping with it; the host gives every cell (`placeAt`). Enter or the
// "+" on a selected empty cell makes a new note there (`newNote`). The open
// note is a `NoteCardEditor`. A narrow pane scrolls the grid sideways rather
// than reflowing it.

import {
  type CardId,
  isTextCard,
  type SeatRecord,
  type TextCard,
  type WriterId,
} from "@pinetrie/core"
import {
  type CatchUps,
  type ColumnAct,
  type Intent,
  notesBoardView,
  type QueueOn,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import { newCardId, type SessionClient } from "@pinetrie/session"
import { useState } from "react"
import { NoteCardEditor } from "./card-editor.tsx"
import { CardGrid } from "./card-grid.tsx"
import { useCardTexts } from "./use-card-texts.ts"

export function NotesBoard(p: {
  session: SessionClient
  /** The thread's notes (`cardsAt("note", …)`). */
  notes: readonly TextCard[]
  /** The column's key: where a drop on a cell lands. */
  columnKey: string
  queueOn: QueueOn | null
  reader: Reader
  readOnly: ReadOnly | null
  catchUps: CatchUps
  seats: readonly SeatRecord[]
  colorOf: (writer: WriterId) => string
  onAct: (act: ColumnAct) => void
  onIntent: (intent: Intent) => void
  onTyping: (card: CardId) => void
}) {
  const [selected, setSelected] = useState(0)
  const texts = useCardTexts(
    p.session,
    p.notes.map(c => c.id),
  )
  const view = notesBoardView({ notes: p.notes, selected, texts })
  const put = (card: CardId, cell: number) =>
    p.onIntent({
      kind: "put",
      card,
      target: { kind: "cell", key: p.columnKey, cell },
    })
  return (
    <CardGrid
      kind="notes"
      colorOf={p.colorOf}
      onMove={(card, cell) => {
        put(card.id, cell)
        setSelected(cell)
      }}
      onCreate={
        p.readOnly !== null
          ? null
          : cell => p.onAct({ kind: "newNote", card: newCardId(), cell })
      }
      onSelect={setSelected}
      reader={p.reader}
      renderOpen={card =>
        !isTextCard(card) ? null : (
          <NoteCardEditor
            card={card}
            catchUps={p.catchUps}
            key={card.id}
            onAct={p.onAct}
            onTyping={p.onTyping}
            queueOn={p.queueOn}
            readOnly={p.readOnly}
            reader={p.reader}
            seats={p.seats}
            session={p.session}
          />
        )
      }
      targetOf={cell => ({ kind: "cell", key: p.columnKey, cell })}
      view={view}
    />
  )
}
