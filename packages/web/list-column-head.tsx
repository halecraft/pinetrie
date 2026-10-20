// web/list-column-head — a list column's header, a note column's or a media
// column's: its fold and its box (`columnHead`), its kind's icon and title,
// its handle, how many it holds, and its ⋯, whose Rename opens the title's
// field for anyone who may write.

import type { CardWidth, MediaId, NoteColumnId } from "@pinetrie/core"
import {
  columnHead,
  countWords,
  type Intent,
  KIND_ICON,
  type ListKind,
  type ReadOnly,
} from "@pinetrie/interface"
import { useState } from "react"
import { ColumnHandle, ColumnHeadStart, ColumnMenu } from "./column-menu.tsx"
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
  const writable = p.readOnly === null
  const head = columnHead({
    card: p.card,
    width: p.width,
    writable,
    unstarted: false,
    folded: false,
    ticked: p.ticked,
    details: false,
    pin: false,
    renamable: writable,
  })
  return (
    <header className="column-head" data-column-head="">
      <div className="head-row">
        <ColumnHeadStart head={head} onIntent={p.onIntent} />
        {renaming && writable ? (
          <>
            <span aria-hidden="true" className="note-column-mark">
              {KIND_ICON[p.kind]}
            </span>
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
          </>
        ) : (
          <ColumnHandle card={p.card} className="note-column-title">
            <span aria-hidden="true" className="note-column-mark">
              {KIND_ICON[p.kind]}
            </span>
            <span data-fold-name="">{p.title}</span>
          </ColumnHandle>
        )}
        <span className="note-count">{countWords(p.kind, p.count)}</span>
        <ColumnMenu
          onIntent={p.onIntent}
          onRename={() => setRenaming(true)}
          sections={head.menu}
        />
      </div>
    </header>
  )
}
