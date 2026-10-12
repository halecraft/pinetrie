// web/note-column — a note column on a task's canvas: its title,
// which anyone renames, and its notes, one under another, each folded to its
// first line and opened while it holds the focus. ↑ and ↓ on a note, or
// Alt+↑/↓ in its box, move it in the column, as a queued card moves in its
// queue. A drop anywhere on the column makes the card a note at its end;
// "+ add a note" makes an empty one there. A column of its task's canvas, at
// its rank there (`canvasColumns`); its header is a drag handle, as a thread
// column's is, its ⋯ folds it, and × trashes it with its notes.

import type { CardId, CardWidth, SeatRecord, WriterId } from "@pinetrie/core"
import {
  ADD_NOTE,
  type ColumnAct,
  dragProps,
  dropProps,
  type Intent,
  KIND_ICON,
  NOTES_EMPTY,
  type NoteColumnView,
  noteCountWords,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import { newCardId, type SessionClient } from "@pinetrie/session"
import { useEffect, useRef, useState } from "react"
import { NoteCardEditor } from "./card-editor.tsx"
import { ColumnHeadEnd } from "./column-menu.tsx"
import { TitleField } from "./title-field.tsx"

export function NoteColumn(p: {
  session: SessionClient
  view: NoteColumnView
  /** How many columns wide its card is drawn. */
  width: CardWidth
  reader: Reader
  readOnly: ReadOnly | null
  seats: readonly SeatRecord[]
  colorOf: (writer: WriterId) => string
  onIntent: (intent: Intent) => void
  onTyping: (card: CardId) => void
}) {
  const { view } = p
  const column = view.column
  // A note's acts are a column's, by the note column's id: where a refusal
  // is said (`atColumn`).
  const act = (a: ColumnAct) =>
    p.onIntent({
      kind: "column",
      column: { kind: "card", card: column },
      act: a,
    })
  const [renaming, setRenaming] = useState(false)
  // "+ add a note" focuses its card's box once the card is drawn.
  const notes = useRef<HTMLDivElement>(null)
  const [focusing, setFocusing] = useState<CardId | null>(null)
  useEffect(() => {
    if (focusing === null) return
    const box = notes.current?.querySelector<HTMLTextAreaElement>(
      `textarea[data-card="${focusing}"]`,
    )
    if (box == null) return
    box.focus()
    setFocusing(null)
  })
  const addNote = () => {
    const card = newCardId()
    setFocusing(card)
    act({ kind: "newNote", card, column })
  }
  return (
    <section
      className="note-column"
      data-card={column}
      data-kind="note-column"
      data-column={column}
      data-width={p.width}
      {...(p.readOnly === null ? dropProps({ kind: "notes", column }) : {})}
    >
      <header
        className="column-head"
        data-column-head=""
        {...dragProps({ kind: "card", card: column })}
      >
        <div className="head-row">
          <span aria-hidden="true" className="note-column-mark">
            {KIND_ICON["note-column"]}
          </span>
          {renaming && p.readOnly === null ? (
            <TitleField
              label="title for this note column"
              onEnd={() => setRenaming(false)}
              onSend={title =>
                p.onIntent({
                  kind: "rename",
                  of: { kind: "note-column", column },
                  title,
                })
              }
              placeholder={view.title}
              stored={view.titled}
            />
          ) : (
            <button
              className="note-column-title"
              disabled={p.readOnly !== null}
              onClick={() => setRenaming(true)}
              title="rename this note column"
              type="button"
            >
              <span data-fold-name="">{view.title}</span>
            </button>
          )}
          <span className="note-count">
            {noteCountWords(view.notes.length)}
          </span>
          <ColumnHeadEnd
            card={column}
            columnKey={column}
            onIntent={p.onIntent}
            width={p.width}
            writable={p.readOnly === null}
          />
        </div>
      </header>
      <div className="note-column-notes" ref={notes}>
        {view.notes.length === 0 && (
          <p className="notes-empty">{NOTES_EMPTY}</p>
        )}
        {view.notes.map(note => (
          <div className="note-card" key={note.id}>
            <NoteCardEditor
              among={view.notes}
              card={note}
              catchUps={null}
              onAct={act}
              onTyping={p.onTyping}
              readOnly={p.readOnly}
              reader={p.reader}
              seats={p.seats}
              session={p.session}
            />
          </div>
        ))}
      </div>
      {p.readOnly === null && (
        <button
          className={ADD_NOTE.className}
          onClick={addNote}
          title={ADD_NOTE.title}
          type="button"
        >
          {ADD_NOTE.label}
        </button>
      )}
    </section>
  )
}
