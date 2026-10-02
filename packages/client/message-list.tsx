// client/message-list — a column's messages, memoised as a whole
// (`message-list-props.ts`): the part of a column that grows with its thread.

import { memo } from "react"
import { callStreams } from "./live.ts"
import { Message } from "./message.tsx"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { messageTools } from "./message-tools.ts"

function MessageListView(p: MessageListProps) {
  const { view, index } = p
  return view.nodes.map((node, i) => (
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
  ))
}

export const MessageList = memo(MessageListView, sameMessageListProps)
