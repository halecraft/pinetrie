// client/column — one open path, read top to bottom, with its own scroll.

import { useTracked } from "@kyneta/react"
import {
  type AgentRun,
  ancestry,
  atEntry,
  type ColumnView,
  entryId,
  type LaneView,
  messageText,
  type Position,
  type ReferenceTarget,
  ROOT,
  type ThreadLane,
  type TreeIndex,
  threadOf,
  type WriterId,
} from "@pineta/core"
import { displayName, type Held, type ReferenceIndex } from "@pineta/marginalia"
import { readStreams, type SessionDocHandle } from "@pineta/schema"
import { useLayoutEffect, useRef } from "react"
import type { Column as ColumnSpec } from "./columns.ts"
import { Composer } from "./composer.tsx"
import { Message } from "./message.tsx"
import { speakerLabel } from "./names.ts"
import { Avatars, nameFor } from "./presence.tsx"
import { colorSlot, trackColor } from "./rail.tsx"
import type { SessionClient } from "./session-view.ts"
import { Start } from "./start.tsx"

export interface ColumnProps {
  session: SessionClient
  /** The column as the reducer holds it: its lane, and whether it is fresh. */
  column: ColumnSpec
  position: number
  view: ColumnView
  index: TreeIndex
  /** This column's colour track; its header carries it. */
  track: number
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<string, readonly number[]>
  /** Ids any open column shows: a branch leaving here that is shown needs no button. */
  shown: ReadonlySet<string>
  refs: ReferenceIndex
  /** Display names by writer, for "queue · agent replies after Bea". */
  nameOf: ReadonlyMap<WriterId, string>
  /** Everyone who can be mentioned (`readParticipants`). */
  participants: readonly string[]
  /** Others following this column's thread, and others typing at its end (ADR-0024). */
  seenBy: readonly WriterId[]
  typing: readonly WriterId[]
  /** This window is typing in this column's composer. */
  onTyping: () => void
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  lanes: readonly LaneView[]
  outbox: readonly Held[]
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<string>
  /** Open a fresh column to the right, forked at `at`. */
  onBranch: (at: string) => void
  /** After a conflict: a fresh column at `at`, which sends `text` there. */
  onBranchInstead: (at: Position, text: string) => void
  /** The empty session's column: turn it into a fresh thread at the root. */
  onStart: (asksAgent: boolean) => void
  /** A fresh column's first send, by id. */
  onSent: (sendId: string) => void
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

  const fresh = p.column.fresh !== undefined
  // Where a send attaches: a fresh column's branch point, else the column's end.
  const at: Position = fresh
    ? p.column.anchor === null
      ? ROOT
      : atEntry(entryId(p.column.anchor))
    : view.tipId === null
      ? ROOT
      : atEntry(entryId(view.tipId))
  // An empty session's column offers the two starts instead of a composer.
  const choosing = !fresh && view.tipId === null

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
  // The lanes running on this column's path stream here.
  const streamingLanes = p.activity
    .filter(r => p.path.has(r.tip))
    .map(r => r.lane)
  // This thread's lane, as the host will find it: busy means a compelled
  // message waits.
  const thread = choosing
    ? undefined
    : threadOf(p.index, p.lanes, {
        at,
        mode: fresh ? "branch" : "reply",
        lane: p.column.lane ?? null,
        me: p.session.writer,
      })
  const lane: ThreadLane =
    thread?.kind === "thread" ? thread.lane : { kind: "none" }
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
      data-key={p.column.key}
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
            ? fresh
              ? p.column.asksAgent === true
                ? "new · with the agent"
                : "new chat"
              : "thread"
            : `from ${forkLabel}: “${forkText}${forkText.length === 48 ? "…" : ""}”`}
        </span>
        <Avatars nameOf={p.nameOf} writers={p.seenBy} />
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
              onBranch={
                i < view.nodes.length - 1
                  ? {
                      title: "open a branch here",
                      go: () => p.onBranch(node.id),
                    }
                  : // At the end, a branch differs from replying only in agent
                    // work: there it steps back down to a conversation.
                    p.column.lane !== undefined
                    ? {
                        title: "continue as a conversation",
                        go: () => p.onBranch(node.id),
                      }
                    : undefined
              }
              onCite={(to: ReferenceTarget) =>
                void p.session.cite(
                  to,
                  view.tipId === null ? ROOT : atEntry(entryId(view.tipId)),
                )
              }
              onOpenBranch={p.onOpen}
            />
          )
        })}
        {streamingLanes.length > 0 && (
          <Streams doc={p.session.doc} lanes={streamingLanes} />
        )}
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
      {choosing ? (
        <Start onStart={p.onStart} />
      ) : (
        <Composer
          asksAgent={p.column.asksAgent === true}
          at={at}
          boundLane={p.column.lane}
          fresh={fresh}
          holderName={holder}
          lane={lane}
          onBranchInstead={text => p.onBranchInstead(at, text)}
          onSend={() => {
            if (!fresh) return undefined
            const id = crypto.randomUUID()
            p.onSent(id)
            return id
          }}
          onTyping={p.onTyping}
          participants={p.participants}
          pending={p.column.fresh?.pending}
          typing={p.typing.map(w => nameFor(p.nameOf, w))}
          session={p.session}
        />
      )}
    </section>
  )
}

/**
 * What the lanes on this path are writing now: the agent's reply, and each
 * running tool's output. Its own component, reading the streams on its own, so
 * a delta re-renders only this, not the column above it.
 */
function Streams({
  doc,
  lanes,
}: {
  doc: SessionDocHandle
  lanes: readonly string[]
}) {
  const open = useTracked(() => readStreams(doc)).filter(s =>
    lanes.includes(s.lane),
  )
  return (
    <>
      {open.map(s =>
        s.kind === "reply" ? (
          <div className="streaming" key={s.id}>
            <span className="role">agent</span>
            <div className="text">{s.text}</div>
          </div>
        ) : (
          <div className="tool live" data-stream={s.id} key={s.id}>
            <span className="tool-label">{s.label}</span>{" "}
            <span className="tool-status">…</span>
            <LiveOutput text={s.text} />
          </div>
        ),
      )}
    </>
  )
}

/** A running tool's output, kept scrolled to its end as it grows. */
function LiveOutput({ text }: { text: string }) {
  const pre = useRef<HTMLPreElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the text
  useLayoutEffect(() => {
    const el = pre.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <pre className="tool-output" ref={pre}>
      {text}
    </pre>
  )
}
