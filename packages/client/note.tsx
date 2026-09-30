// client/note — a note's card, and the notes index (ADR-0025).
//
// A note is about a message. Its text is its own document, bound to a
// textarea with `useText`, so everyone's edits merge as they type. Its record
// (state, contributors) is read from the session. The card shows who else is
// editing it (presence). The next message is drafted in a card
// (`card-editor.tsx`, ADR-0048), not here.

import { useText, useValue } from "@kyneta/react"
import type { NoteId, NoteRecord, NoteState, WriterId } from "@pineta/core"
import { NOTE_FILTERS, type NoteFilter, type NoteRow } from "@pineta/reads"
import { useEffect, useRef, useState } from "react"
import { MessageText } from "./message-text.tsx"
import { namesOf } from "./names.ts"
import type { SessionClient } from "./session-view.ts"

const STATE_LABEL: Record<NoteState, string> = {
  open: "open for editing",
  done: "done",
}

/** How long a card grows before it offers to collapse, in characters. */
const LONG = 600

export function NoteCard({
  session,
  note,
  nameOf,
  editors,
  onFocus,
}: {
  session: SessionClient
  note: NoteRecord
  nameOf: ReadonlyMap<WriterId, string>
  /** Others editing this note now (presence). */
  editors: readonly WriterId[]
  /** This window started editing it: the column's sticky bar follows it. */
  onFocus: (id: NoteId) => void
}) {
  const doc = session.noteText(note.id)
  const text = useValue(doc.text)
  const bind = useText(doc.text)
  const [status, setStatus] = useState("")
  const [collapsed, setCollapsed] = useState(false)
  // Presence says "editing" while the editor has focus: refreshed as they
  // type, at most once a second, and null once they leave it, or once the
  // editor goes (a note marked done) with no blur to say so.
  const said = useRef(0)
  const focused = useRef(false)
  const editable = note.state !== "done"
  useEffect(() => {
    if (editable) return
    if (focused.current) session.setEditing(null)
    focused.current = false
  }, [editable, session])
  useEffect(
    () => () => {
      if (focused.current) session.setEditing(null)
    },
    [session],
  )
  const editing = () => {
    const t = Date.now()
    if (t - said.current < 1_000) return
    said.current = t
    session.setEditing(note.id)
  }
  const act = async (kind: "done" | "reopen") => {
    setStatus("")
    const outcome = await session.note({ kind, note: note.id })
    setStatus(outcome.kind === "refused" ? `not done: ${outcome.message}` : "")
  }
  return (
    <div
      className="note"
      data-collapsed={collapsed ? "yes" : "no"}
      data-note={note.id}
      data-state={note.state}
    >
      <div className="note-head">
        <span className="note-state">{STATE_LABEL[note.state]}</span>
        {note.contributors.length > 0 && (
          <span className="note-by">
            {" "}
            · {namesOf(nameOf, note.contributors)}
          </span>
        )}
        {note.changedSinceDone && (
          <span className="note-changed"> · changed since done</span>
        )}
        {editable && editors.length > 0 && (
          <span className="note-editing">
            {" "}
            · {namesOf(nameOf, editors)} {editors.length === 1 ? "is" : "are"}{" "}
            editing
          </span>
        )}
      </div>
      {!editable ? (
        <MessageText className="note-text" mode="committed" text={text} />
      ) : (
        <textarea
          aria-label="the note"
          className="note-text"
          onBlur={() => {
            said.current = 0
            focused.current = false
            session.setEditing(null)
          }}
          onFocus={() => {
            focused.current = true
            onFocus(note.id)
            editing()
          }}
          onInput={editing}
          ref={bind}
          rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
        />
      )}
      <div className="note-actions">
        {note.state === "done" ? (
          <button
            className="note-reopen"
            onClick={() => void act("reopen")}
            type="button"
          >
            reopen
          </button>
        ) : (
          <button
            className="note-done"
            onClick={() => void act("done")}
            type="button"
          >
            mark done
          </button>
        )}
        {text.length > LONG && (
          <button
            className="note-collapse"
            onClick={() => setCollapsed(!collapsed)}
            type="button"
          >
            {collapsed ? "expand" : "collapse"}
          </button>
        )}
        <span className="status">{status}</span>
      </div>
    </div>
  )
}

const FILTER_LABEL: Record<NoteFilter, string> = {
  all: "all",
  open: "open",
  done: "done",
  changed: "changed since done",
  mine: "mine",
}

/**
 * Every note, filterable, newest first (`notesIndex`). A row opens its note's
 * column. `rows` is what `filter` keeps; the app holds the filter.
 */
export function NotesIndex({
  session,
  rows,
  filter,
  onFilter,
  nameOf,
  onPick,
  onClose,
}: {
  session: SessionClient
  rows: readonly NoteRow[]
  filter: NoteFilter
  onFilter: (filter: NoteFilter) => void
  nameOf: ReadonlyMap<WriterId, string>
  onPick: (at: string) => void
  /** Escape closes it, as does picking a row. */
  onClose: () => void
}) {
  return (
    <div
      aria-label="notes"
      className="notes-index"
      onKeyDown={e => {
        if (e.key === "Escape") onClose()
      }}
      role="dialog"
    >
      <div className="notes-filters">
        {NOTE_FILTERS.map(f => (
          <button
            aria-pressed={f === filter}
            data-filter={f}
            key={f}
            onClick={() => onFilter(f)}
            type="button"
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {rows.length === 0 && <div className="notes-empty">no notes</div>}
      {rows.map(row => (
        <NoteIndexRow
          key={row.note.id}
          nameOf={nameOf}
          onPick={onPick}
          row={row}
          session={session}
        />
      ))}
    </div>
  )
}

function NoteIndexRow({
  session,
  row,
  nameOf,
  onPick,
}: {
  session: SessionClient
  row: NoteRow
  nameOf: ReadonlyMap<WriterId, string>
  onPick: (at: string) => void
}) {
  const text = useValue(session.noteText(row.note.id).text)
  const first = text.split("\n").find(l => l.trim() !== "") ?? "(empty)"
  const { at } = row
  return (
    <button
      className="notes-row"
      data-note={row.note.id}
      data-state={row.note.state}
      disabled={at === null}
      onClick={() => at !== null && onPick(at)}
      type="button"
    >
      <span className="notes-first">{first.slice(0, 80)}</span>
      <span className="notes-meta">
        {STATE_LABEL[row.note.state]}
        {row.note.changedSinceDone ? " · changed" : ""}
        {row.note.contributors.length > 0
          ? ` · ${namesOf(nameOf, row.note.contributors)}`
          : ""}
      </span>
    </button>
  )
}
