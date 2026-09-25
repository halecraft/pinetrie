// client/column — one open path, read top to bottom, with its own scroll.

import { useTracked } from "@kyneta/react"
import {
  type AgentRun,
  ancestry,
  atEntry,
  type ColumnView,
  type EntryId,
  entryId,
  type LaneView,
  messageText,
  type ReferenceTarget,
  type Responder,
  ROOT,
  type TreeIndex,
  threadLaneAt,
  type WriterId,
} from "@pineta/core"
import {
  displayName,
  effectiveDefault,
  type Held,
  type ReferenceIndex,
  rulesAlong,
} from "@pineta/marginalia"
import type { SessionDocHandle } from "@pineta/schema"
import { useLayoutEffect, useRef } from "react"
import { Composer } from "./composer.tsx"
import { Message } from "./message.tsx"
import { speakerLabel } from "./names.ts"
import { readStreaming } from "./projection.ts"
import { colorSlot, trackColor } from "./rail.tsx"
import type { SessionClient } from "./session-view.ts"

export interface ColumnProps {
  session: SessionClient
  columnKey: string
  position: number
  view: ColumnView
  index: TreeIndex
  /** This column's colour track; its header carries it. */
  track: number
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<string, readonly number[]>
  /** Ids any open column shows: a branch leaving here that is shown needs no button. */
  shown: ReadonlySet<string>
  rules: ReadonlyMap<EntryId, Responder>
  refs: ReferenceIndex
  /** Display names by writer, for "queue · agent replies after Bea". */
  nameOf: ReadonlyMap<WriterId, string>
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  lanes: readonly LaneView[]
  outbox: readonly Held[]
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<string>
  onBranchHere: (at: string) => void
  onOpen: (anchor: string) => void
  onMakeMain: () => void
  onClose: () => void
}

export function Column(p: ColumnProps) {
  const { view, index } = p
  const body = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // The spacer exists to line a new column up with its fork point. A column
  // with no fork point (the first, or one moved there by "make main") has
  // nothing to line up with, so it keeps no spacer.
  useLayoutEffect(() => {
    if (view.forkFrom === null && spacer.current !== null)
      spacer.current.style.height = "0px"
  }, [view.forkFrom])

  // The rule in force above this column's first message, then along it.
  const inherited = effectiveDefault(
    view.forkFrom === null
      ? ROOT
      : { kind: "entry", id: entryId(view.forkFrom) },
    index,
    p.rules,
  )
  const ids = view.nodes.map(n => n.id)
  const rules = rulesAlong(ids, inherited, p.rules)
  const ruleAtEnd = rules.at(-1) ?? inherited

  // The agent joined where it was first asked, unless that is above this column.
  const askedAbove =
    view.forkFrom !== null &&
    ancestry(index, view.forkFrom).path.some(
      id => index.entries[id]?.message?.compelled === true,
    )
  const joinedAt = askedAbove
    ? undefined
    : view.nodes.find(n => n.compelled === true)?.id

  // The agent reads each running lane's path; a message on none of them is
  // outside every reply being written.
  const running = p.activity.length > 0
  const lit = (id: string) => p.activity.some(r => r.path.has(id))
  // The runs whose tip is on this column's path stream here.
  const streams = p.activity.filter(r => p.path.has(r.tip))
  // This thread's lane, at the column's end: busy means a compelled message waits.
  const lane = threadLaneAt(
    p.lanes,
    view.tipId === null ? ROOT : atEntry(entryId(view.tipId)),
  )
  const waiting =
    lane.kind === "lane" ? p.outbox.filter(h => h.lane === lane.name) : []
  const holder =
    lane.kind === "lane" && lane.askedBy !== null
      ? displayName(lane.askedBy, p.nameOf.get(lane.askedBy))
      : null

  // Follow new messages while the reader is at the bottom; leave them alone
  // once they have scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the column grows
  useLayoutEffect(() => {
    const el = body.current
    if (el !== null && atBottom.current) el.scrollTop = el.scrollHeight
  }, [view.nodes.length, view.tipId])

  const fork = view.forkFrom === null ? undefined : index.entries[view.forkFrom]
  const forkLabel =
    fork?.message?.role === "chat"
      ? speakerLabel(p.nameOf, fork.message.writer, fork.message.author ?? "")
      : fork?.message?.role === "assistant"
        ? "agent"
        : ""
  const forkText = messageText(fork?.message).slice(0, 48)

  return (
    <section
      className="column"
      data-key={p.columnKey}
      data-position={p.position}
      data-track={p.track}
    >
      <header
        className="column-head"
        data-color={colorSlot(p.track)}
        style={{ borderTopColor: trackColor(p.track) }}
      >
        <span className="fork-label">
          {fork === undefined
            ? "thread"
            : `from ${forkLabel}: “${forkText}${forkText.length === 48 ? "…" : ""}”`}
        </span>
        {p.position > 0 && (
          <button className="make-main" onClick={p.onMakeMain} type="button">
            make main
          </button>
        )}
        <button className="close" onClick={p.onClose} type="button">
          close
        </button>
      </header>
      <div
        className="column-body"
        onScroll={e => {
          const el = e.currentTarget
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        ref={body}
      >
        {/* Room above the first message, so opening can bring it level with
            its fork point even when the column is short. */}
        <div className="spacer" ref={spacer} />
        {view.nodes.map((node, i) => {
          const id = entryId(node.id)
          return (
            <Message
              cites={p.refs.from.get(id) ?? []}
              citedBy={p.refs.to.get(id) ?? []}
              closedBranches={node.branches.filter(b => !p.shown.has(b.rootId))}
              forkTracks={p.forks.get(node.id) ?? []}
              joined={node.id === joinedAt}
              key={node.id}
              light={running ? (lit(node.id) ? "lit" : "dim") : undefined}
              nameOf={p.nameOf}
              node={node}
              onBranchHere={
                // Below a column's last message is the column itself.
                i === view.nodes.length - 1
                  ? undefined
                  : () => p.onBranchHere(node.id)
              }
              onCite={(to: ReferenceTarget) =>
                void p.session.cite(
                  to,
                  view.tipId === null ? ROOT : atEntry(entryId(view.tipId)),
                )
              }
              onOpenBranch={p.onOpen}
              onSetRule={mode => void p.session.setThreadMode(id, mode)}
              ruleHere={rules[i] ?? inherited}
              ruleSet={p.rules.get(id)}
            />
          )
        })}
        {streams.map(r => (
          <Streaming doc={p.session.doc} key={r.lane} lane={r.lane} />
        ))}
        {/* Messages waiting for this thread's lane, in the order they will
            be taken. They are not in the tree yet. */}
        {waiting.map((h, n) => (
          <div className="msg waiting" data-held={h.id} key={h.id}>
            <span className="role">
              {speakerLabel(p.nameOf, h.details.author, h.details.authorName)} ·
              waiting · {n + 1} of {waiting.length}
            </span>
            <div className="text">{h.details.text}</div>
          </div>
        ))}
      </div>
      <Composer
        at={view.tipId}
        fresh={view.nodes.length === 0 && view.forkFrom !== null}
        holderName={holder}
        lane={lane}
        rule={ruleAtEnd}
        session={p.session}
      />
    </section>
  )
}

/**
 * Live token deltas. Its own component, reading the stream on its own, so a
 * delta re-renders only this, not the column above it.
 */
function Streaming({ doc, lane }: { doc: SessionDocHandle; lane: string }) {
  const streaming = useTracked(() => readStreaming(doc, lane))
  if (streaming === null) return null
  return (
    <div className="streaming">
      <span className="role">agent</span>
      <div className="text">{streaming.text}</div>
    </div>
  )
}
