// client/message-list — a column's messages, memoised as a whole
// (`message-list-props.ts`): the part of a column that grows with its thread.
// Each ask's work is drawn together, folded or open (`AskWork`, ADR-0056).

import { ancestry, type EntryId, segmentPath } from "@pineta/core"
import { memo } from "react"
import { askView, type ColumnRow, columnRows } from "./ask-view.ts"
import { LEFT_WORDS } from "./ask-words.ts"
import { AskWork } from "./ask-work.tsx"
import { callStreams } from "./live.ts"
import { Message } from "./message.tsx"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { messageTools } from "./message-tools.ts"
import { nameFor } from "./presence.tsx"

function MessageListView(p: MessageListProps) {
  const { view, index, asks } = p
  const at = new Map(view.nodes.map((node, i) => [node.id, i]))
  const message = (id: EntryId) => {
    const i = at.get(id)
    const node = i === undefined ? undefined : view.nodes[i]
    if (i === undefined || node === undefined) return null
    return (
      <Message
        doc={p.doc}
        rows={p.rows}
        streams={callStreams(node.toolCalls, p.tools)}
        closedBranches={node.branches.filter(b => !p.shown.has(b.rootId))}
        forkTracks={p.forks.get(node.id) ?? []}
        join={p.joins.get(node.id)}
        key={node.id}
        nameOf={p.nameOf}
        node={node}
        onAct={p.onAct}
        tools={messageTools(node, {
          parentId: index.parentOf(node.id),
          isLast: i === view.nodes.length - 1,
          lane: p.lane,
          writable: p.writable,
        })}
      />
    )
  }
  const segments = segmentPath(
    index,
    asks,
    view.nodes.map(n => n.id),
    new Set(p.landmarks),
  )
  const releasedPath =
    p.releasedTip === null ? null : new Set(ancestry(index, p.releasedTip).path)
  const nameOf = (w: Parameters<typeof nameFor>[1]) => nameFor(p.nameOf, w)
  const holds = (row: ColumnRow, id: string): boolean =>
    row.kind === "message"
      ? row.id === id
      : row.parts.some(s =>
          s.kind === "entry" ? s.id === id : s.ids.includes(id as EntryId),
        )
  return columnRows(segments, asks).flatMap(row => [
    p.leftBefore !== null && holds(row, p.leftBefore) && (
      <div
        aria-hidden
        className="left-line"
        data-words={LEFT_WORDS}
        key="left-line"
      />
    ),
    row.kind === "message" ? (
      message(row.id)
    ) : (
      <AskWork
        density={p.density}
        folds={p.folds}
        key={`ask-${row.ask}-${row.parts[0].kind === "entry" ? row.parts[0].id : row.parts[0].ids[0]}`}
        message={message}
        onReview={p.onReviewAsk}
        parts={row.parts}
        view={askView({
          index,
          asks,
          ask: row.ask,
          runningAsk: p.runningAsk,
          stops: p.stops,
          revisions: p.revisions,
          digests: p.digests,
          releasedPath,
          nameOf,
        })}
      />
    ),
  ])
}

export const MessageList = memo(MessageListView, sameMessageListProps)
