// client/message-list — a column's messages, memoised as a whole
// (`message-list-props.ts`): the part of a column that grows with its thread.

import type { NoteRecord } from "@pineta/core"
import { memo } from "react"
import { callStreams } from "./live.ts"
import { Message } from "./message.tsx"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { messageTools } from "./message-tools.ts"
import { NoteCard } from "./note.tsx"

function MessageListView(p: MessageListProps) {
  const { view, index } = p
  // A note's card is a new element each render, so a message with one
  // redraws whenever the list does.
  const card = (note: NoteRecord) => (
    <NoteCard
      key={note.id}
      nameOf={p.nameOf}
      note={note}
      onFocus={p.onFocusNote}
      session={p.session}
    />
  )
  return view.nodes.map((node, i) => {
    const drawn = p.notesOf.get(node.id)
    return (
      <Message
        doc={p.session.doc}
        streams={callStreams(node.toolCalls, p.tools)}
        closedBranches={node.branches.filter(b => !p.shown.has(b.rootId))}
        forkTracks={p.forks.get(node.id) ?? []}
        join={p.joins.get(node.id)}
        key={node.id}
        nameOf={p.nameOf}
        node={node}
        about={drawn && card(drawn)}
        onAct={p.onAct}
        tools={messageTools(node, {
          parentId: index.parentOf(node.id),
          isLast: i === view.nodes.length - 1,
          lane: p.lane,
          writable: p.writable,
          hasNoteAbout: drawn !== undefined,
        })}
      />
    )
  })
}

export const MessageList = memo(MessageListView, sameMessageListProps)
