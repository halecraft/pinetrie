// client/column — one open path, read top to bottom, with its own scroll.

import { useTracked } from "@kyneta/react"
import {
  type AgentActivity,
  ancestry,
  type ColumnView,
  type EntryId,
  entryId,
  laneNameForAgent,
  messageText,
  type ReferenceTarget,
  type Responder,
  ROOT,
  THE_AGENT,
  type TreeIndex,
} from "@pineta/core"
import {
  effectiveDefault,
  type ReferenceIndex,
  rulesAlong,
} from "@pineta/marginalia"
import type { SessionDocHandle } from "@pineta/schema"
import { useLayoutEffect, useRef } from "react"
import { Composer } from "./composer.tsx"
import { Message } from "./message.tsx"
import { readStreaming } from "./projection.ts"
import { colorSlot, trackColor } from "./rail.tsx"
import type { SessionClient } from "./session-view.ts"

/** Only the agent streams into a column: people's messages arrive whole. */
const AGENT_LANE = laneNameForAgent(THE_AGENT)

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
  names: readonly string[]
  activity: AgentActivity
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

  const replying = p.activity.kind === "replying" ? p.activity : undefined
  const streamsHere = replying !== undefined && p.path.has(replying.tip)

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
      ? (fork.message.author ?? "")
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
              light={
                replying === undefined
                  ? undefined
                  : replying.path.has(node.id)
                    ? "lit"
                    : "dim"
              }
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
                  view.tipId === null
                    ? undefined
                    : { kind: "entry", id: entryId(view.tipId) },
                )
              }
              onOpenBranch={p.onOpen}
              onSetRule={mode => void p.session.setThreadMode(id, mode)}
              ruleHere={rules[i] ?? inherited}
              ruleSet={p.rules.get(id)}
            />
          )
        })}
        {streamsHere && <Streaming doc={p.session.doc} />}
      </div>
      <Composer
        at={view.tipId}
        fresh={view.nodes.length === 0 && view.forkFrom !== null}
        names={p.names}
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
function Streaming({ doc }: { doc: SessionDocHandle }) {
  const streaming = useTracked(() => readStreaming(doc, AGENT_LANE))
  if (streaming === null) return null
  return (
    <div className="streaming">
      <span className="role">agent</span>
      <div className="text">{streaming.text}</div>
    </div>
  )
}
