// web/list-column-head — a list column's header, a note column's or a media
// column's: its kind's icon, its title (anyone who may write renames it),
// how many it holds, its ⋯ and its fold. A drag handle, as a thread column's
// header is.

import type { CardWidth, MediaId, NoteColumnId } from "@pinetrie/core"
import {
  countWords,
  dragProps,
  type Intent,
  KIND_ICON,
  type ListKind,
  type ReadOnly,
} from "@pinetrie/interface"
import { useState } from "react"
import { ColumnHeadEnd } from "./column-menu.tsx"
import { TitleField } from "./title-field.tsx"

/** What each list column's header calls it. */
const NAME: Readonly<Record<ListKind, string>> = {
  "note-column": "note column",
  media: "media column",
}

export function ListColumnHead(p: {
  kind: ListKind
  card: NoteColumnId | MediaId
  title: string
  /** Its stored title, or null: what the rename field starts with. */
  titled: string | null
  count: number
  width: CardWidth
  readOnly: ReadOnly | null
  onIntent: (intent: Intent) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const name = NAME[p.kind]
  return (
    <header
      className="column-head"
      data-column-head=""
      {...dragProps({ kind: "card", card: p.card })}
    >
      <div className="head-row">
        <span aria-hidden="true" className="note-column-mark">
          {KIND_ICON[p.kind]}
        </span>
        {renaming && p.readOnly === null ? (
          <TitleField
            label={`title for this ${name}`}
            onEnd={() => setRenaming(false)}
            onSend={title =>
              p.onIntent({
                kind: "rename",
                of: { kind: "card", card: p.card },
                title,
              })
            }
            placeholder={p.title}
            stored={p.titled}
          />
        ) : (
          <button
            className="note-column-title"
            disabled={p.readOnly !== null}
            onClick={() => setRenaming(true)}
            title={`rename this ${name}`}
            type="button"
          >
            <span data-fold-name="">{p.title}</span>
          </button>
        )}
        <span className="note-count">{countWords(p.kind, p.count)}</span>
        <ColumnHeadEnd
          card={p.card}
          onIntent={p.onIntent}
          unstarted={false}
          width={p.width}
          writable={p.readOnly === null}
        />
      </div>
    </header>
  )
}
