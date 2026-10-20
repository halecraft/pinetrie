// web/list-column-head — a list column's header, a note column's or a media
// column's: its fold and its box (`columnHead`), its kind's icon, its title
// (anyone who may write renames it), how many it holds, and its ⋯. A drag
// handle, as a thread column's header is.

import type { CardWidth, MediaId, NoteColumnId } from "@pinetrie/core"
import {
  columnHead,
  countWords,
  type Intent,
  KIND_ICON,
  type ListKind,
  type ReadOnly,
} from "@pinetrie/interface"
import { dragProps } from "@pinetrie/web-core"
import { useState } from "react"
import { Button } from "./button.tsx"
import { ColumnHeadStart, ColumnMenu } from "./column-menu.tsx"
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
  /** Its card's box (`ColumnContent`). */
  ticked: boolean
  readOnly: ReadOnly | null
  onIntent: (intent: Intent) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const name = NAME[p.kind]
  const head = columnHead({
    card: p.card,
    width: p.width,
    writable: p.readOnly === null,
    unstarted: false,
    folded: false,
    ticked: p.ticked,
  })
  return (
    <header
      className="column-head"
      data-column-head=""
      {...dragProps({ kind: "card", card: p.card })}
    >
      <div className="head-row">
        <ColumnHeadStart head={head} onIntent={p.onIntent} />
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
          <Button
            look="plain"
            className="note-column-title"
            disabled={p.readOnly !== null}
            onClick={() => setRenaming(true)}
            title={`rename this ${name}`}
          >
            <span data-fold-name="">{p.title}</span>
          </Button>
        )}
        <span className="note-count">{countWords(p.kind, p.count)}</span>
        <ColumnMenu onIntent={p.onIntent} sections={head.menu} />
      </div>
    </header>
  )
}
