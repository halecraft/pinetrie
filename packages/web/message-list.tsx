// web/message-list — a column's messages, memoised as a whole
// (`message-list-props.ts`): the part of a column that grows with its thread.
// Each ask's work is drawn together, folded or open (`AskWork`).

import { ancestry, type EntryId } from "@pinetrie/core"
import {
  askView,
  type ColumnRow,
  callStreams,
  columnRows,
  LEFT_WORDS,
  lastEndedAsk,
  messageTools,
  pinnedMarkers,
  promptParent,
  segmentPath,
} from "@pinetrie/interface"
import { Fragment, memo, useEffect } from "react"
import { AskWork } from "./ask-work.tsx"
import { markCommit } from "./commit-marks.ts"
import { MarginFace } from "./margin.tsx"
import { Message } from "./message.tsx"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { nameFor } from "./presence.tsx"

function MessageListView(p: MessageListProps) {
  // No dependency list: once per commit of the list itself.
  useEffect(() => markCommit("MessageListView"))
  const { view, index, asks } = p
  const at = new Map(view.nodes.map((node, i) => [node.id, i]))
  const markers = pinnedMarkers(index, view.nodes)
  const message = (id: EntryId) => {
    const i = at.get(id)
    const node = i === undefined ? undefined : view.nodes[i]
    if (i === undefined || node === undefined) return null
    const comments = p.margins.get(node.id) ?? 0
    // Its margin: open under it, else its face while it holds comments.
    const margin =
      p.openMargin === node.id ? (
        p.marginSlot
      ) : comments > 0 ? (
        <MarginFace count={comments} onOpen={() => p.onMargin(node.id)} />
      ) : null
    return (
      <Fragment key={node.id}>
        <Message
          live={p.live}
          rows={p.rows}
          streams={callStreams(node.toolCalls, p.tools)}
          closedBranches={node.branches.filter(b => !p.shown.has(b.rootId))}
          forkTracks={p.forks.get(node.id) ?? []}
          join={p.joins.get(node.id)}
          crossTaskLink={p.crossTaskLinks.get(node.id)}
          onLink={p.onLink}
          key={node.id}
          pinned={markers.get(node.id)}
          nameOf={p.nameOf}
          node={node}
          onAct={p.onAct}
          tools={messageTools(node, {
            parentId: promptParent(index, node.id),
            isLast: i === view.nodes.length - 1,
            lane: p.lane,
            writable: p.writable,
          })}
        />
        {margin}
      </Fragment>
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
  const holds = (row: ColumnRow, id: EntryId): boolean =>
    row.kind === "message"
      ? row.id === id
      : row.parts.some(s =>
          s.kind === "entry" ? s.id === id : s.ids.includes(id),
        )
  const rows = columnRows(segments, asks)
  const lastEnded = lastEndedAsk(rows, p.runningAsk)
  return rows.flatMap(row => [
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
        parts={row.parts}
        view={askView({
          index,
          asks,
          ask: row.ask,
          runningAsk: p.runningAsk,
          lastEnded,
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
