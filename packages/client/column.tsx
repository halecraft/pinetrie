// client/column — one open path, read top to bottom, with its own scroll.

import { useTracked } from "@kyneta/react"
import {
  type AgentRun,
  ancestry,
  atEntry,
  type ColumnView,
  type CommandSummary,
  type EntryId,
  entryId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  messageText,
  type NoteId,
  type NoteRecord,
  nearestRevision,
  type OfferRecord,
  type Position,
  type ProjectRecord,
  promptOf,
  type ReferenceTarget,
  type RevisionRecord,
  ROOT,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  threadOf,
  type WriterId,
  workFor,
} from "@pineta/core"
import {
  displayName,
  draftFor,
  type Held,
  noteEntry,
  type OfferActivity,
  type OfferButton,
  type OfferView,
  offerView,
  type ReferenceIndex,
} from "@pineta/marginalia"
import { readStreams, type SessionDocHandle } from "@pineta/schema"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { branchPrefill, type Column as ColumnSpec } from "./columns.ts"
import { Composer, type ReadOnly } from "./composer.tsx"
import { Menu } from "./menu.tsx"
import { Message } from "./message.tsx"
import { MessageText } from "./message-text.tsx"
import { speakerLabel, withContributors } from "./names.ts"
import { NoteCard } from "./note.tsx"
import { Avatars, nameFor } from "./presence.tsx"
import { colorSlot, trackColor } from "./rail.tsx"
import { keyMove } from "./reorder.ts"
import type { SessionClient } from "./session-view.ts"
import { useFollow } from "./use-follow.ts"

export interface ColumnProps {
  session: SessionClient
  /** The column as the reducer holds it: its lane, and whether it is fresh. */
  column: ColumnSpec
  position: number
  /** How many columns the strip holds: with two or more, a column can move. */
  count: number
  view: ColumnView
  index: TreeIndex
  /** This column's colour track; its header carries it. */
  track: number
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<string, readonly number[]>
  /** Ids any column of this tab shows: a branch leaving here that is shown needs no button. */
  shown: ReadonlySet<string>
  refs: ReferenceIndex
  /** Display names by writer, for "queue · agent replies after Bea". */
  nameOf: ReadonlyMap<WriterId, string>
  /** Everyone who can be mentioned (`readParticipants`). */
  participants: readonly string[]
  /** Others following this column's thread, and others typing at its end (ADR-0024). */
  seenBy: readonly WriterId[]
  typing: readonly WriterId[]
  /** Each person's colour (`presenceColors`). */
  colorOf: (writer: WriterId) => string
  /** This window is typing in this column's composer. */
  onTyping: () => void
  /** Every note's record (ADR-0025). */
  notes: readonly NoteRecord[]
  /** Others editing a note now (presence), each person once. */
  editorsOf: (note: string) => readonly WriterId[]
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  lanes: readonly LaneView[]
  outbox: readonly Held[]
  /** Where lanes work, the files at each entry, and landings (ADR-0032). */
  work: WorkFacts
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<string>
  /**
   * Open a fresh column to the right, forked at `at`, its composer starting
   * with `prefill`.
   */
  onBranch: (at: string, prefill: string | undefined) => void
  /**
   * After a conflict: a fresh column at `at`, which sends `text` there. A
   * conflict needs a reply at an entry: a `branch` never conflicts.
   */
  onBranchInstead: (at: EntryId, text: string) => void
  /** Nothing may be written here (ADR-0029): no composer, no tools that write. */
  readOnly: ReadOnly | null
  /** A fresh column's first send, by id. */
  onSent: (sendId: string) => void
  onOpen: (anchor: string) => void
  /** Move this column to index `to`, from its grip's keys (`keyMove`). */
  onMove: (to: number) => void
  onClose: () => void
  /**
   * Whether "close" does anything: not on a root tab's only column, which the
   * root would give back at once (`columnsOf`), nor in a preview.
   */
  closable: boolean
}

/** What the host records about where lanes work, read with everything else. */
export interface WorkFacts {
  readonly project: ProjectRecord | null
  /** The commands the host's pi loaded (ADR-0036). */
  readonly commands: readonly CommandSummary[]
  readonly lanes: ReadonlyMap<string, LaneRecord>
  readonly revisions: ReadonlyMap<string, RevisionRecord>
  readonly landings: readonly LandingRecord[]
  /** Each lane's offer in your repo (ADR-0038). */
  readonly offers: ReadonlyMap<string, OfferRecord>
  /** Each lane's name (ADR-0039). */
  readonly names: ReadonlyMap<LaneName, ThreadName>
}

/**
 * A lane as its column's header says it: its name, then where it works, its
 * own copy or the directory it shares (ADR-0039).
 */
function whereLabel(
  name: ThreadName | undefined,
  record: LaneRecord | undefined,
): string | null {
  const where =
    record === undefined
      ? undefined
      : record.work.kind === "direct"
        ? `in ${record.work.dir} · shared`
        : "own copy"
  const parts = [name, where].filter(p => p !== undefined)
  return parts.length === 0 ? null : parts.join(" · ")
}

export function Column(p: ColumnProps) {
  const { view, index } = p
  const body = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const end = useFollow(body, content)

  // A move from the grip's keys brings the column into view: End can put it
  // past the strip's edge. Its grip keeps focus through React's move.
  const grip = useRef<HTMLButtonElement>(null)
  const movedByKey = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the column has moved
  useLayoutEffect(() => {
    if (!movedByKey.current) return
    movedByKey.current = false
    grip.current
      ?.closest(".column")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [p.position])

  // The spacer exists to line a new column up with its fork point. A column
  // with no fork point (the first, or one moved there) has nothing to line up
  // with, so it keeps no spacer.
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
  const writable = p.readOnly === null

  // The agent joined where it was first asked, unless that is above this column.
  const askedAbove =
    view.forkFrom !== null &&
    ancestry(index, view.forkFrom).path.some(
      id => index.entries[id]?.message?.compelled === true,
    )
  const joinedAt = askedAbove
    ? undefined
    : view.nodes.find(n => n.compelled === true)?.id

  // The lanes running on this column's path stream here.
  const streamingLanes = p.activity
    .filter(r => p.path.has(r.tip))
    .map(r => r.lane)
  // This thread's lane, as the host will find it: busy means a compelled
  // message waits.
  const thread = threadOf(p.index, p.lanes, {
    at,
    mode: fresh ? "branch" : "reply",
    lane: p.column.lane ?? null,
    me: p.session.writer,
  })
  const lane: ThreadLane =
    thread.kind === "thread" ? thread.lane : { kind: "none" }
  const waiting =
    lane.kind === "lane" ? p.outbox.filter(h => h.lane === lane.name) : []
  // Where this thread's lane works, its latest resolution and its offer
  // (ADR-0032, ADR-0033, ADR-0038).
  const laneRecord =
    lane.kind === "lane" ? p.work.lanes.get(lane.name) : undefined
  const threadName =
    lane.kind === "lane" ? p.work.names.get(lane.name) : undefined
  const where = whereLabel(threadName, laneRecord)
  const landing =
    lane.kind === "lane"
      ? p.work.landings.filter(l => l.lane === lane.name).at(-1)
      : undefined
  const laneView =
    lane.kind === "lane" ? p.lanes.find(l => l.name === lane.name) : undefined
  const offer =
    writable &&
    lane.kind === "lane" &&
    laneRecord?.work.kind === "own" &&
    p.work.project?.kind === "lanes"
      ? offerView({
          offer: p.work.offers.get(lane.name),
          activity: activityOf(index, laneView),
          landing,
        })
      : null
  // An update's intent, put in this column's composer (ADR-0038).
  const [prefill, setPrefill] = useState<{
    readonly text: string
    readonly key: number
  } | null>(null)
  const act = (button: OfferButton) => {
    if (lane.kind !== "lane") return
    if (button === "update" || button === "resolve")
      void p.session.update(lane.name).then(outcome => {
        if (outcome.kind === "updated" && outcome.text !== "")
          setPrefill({ text: outcome.text, key: Date.now() })
      })
    else void p.session.offer(lane.name, button)
  }
  // Where a lane this column's next send creates would work, before a choice.
  const defaultWork = workFor({
    choice: null,
    above: nearestRevision(index, p.work.revisions, at).lane,
    lanes: p.work.lanes,
    project: p.work.project,
  })
  const holder =
    lane.kind === "lane" && lane.askedBy !== null
      ? displayName(lane.askedBy, p.nameOf.get(lane.askedBy))
      : null

  const fork = view.forkFrom === null ? undefined : index.entries[view.forkFrom]
  const forkLabel =
    fork?.message?.role === "chat"
      ? speakerLabel(p.nameOf, fork.message.writer, fork.message.author ?? "")
      : fork?.message?.role === "assistant"
        ? "agent"
        : ""
  const forkText = firstLine(messageText(fork?.message), 48)

  // Notes by the message they are the text of, and this thread's draft.
  const noteOf = new Map(
    p.notes.flatMap(n => {
      const entry = noteEntry(n, index)
      return entry === null ? [] : [[entry as string, n] as const]
    }),
  )
  const draft =
    fresh || view.tipId === null || !writable
      ? undefined
      : draftFor(view.tipId, p.lanes, index, p.notes)
  // The note this window is editing: while it is scrolled out of view, a bar
  // at the column's top leads back to it.
  const [editingNote, setEditingNote] = useState<NoteId | null>(null)
  const [outOfView, setOutOfView] = useState(false)
  const edited = p.notes.find(n => n.id === editingNote)
  const stillEdited = edited !== undefined && edited.state !== "done"
  const [joined, setJoined] = useState<NoteId | null>(null)
  const card = (note: NoteRecord) => (
    <NoteCard
      editors={p.editorsOf(note.id)}
      key={note.id}
      nameOf={p.nameOf}
      note={note}
      onFocus={setEditingNote}
      session={p.session}
    />
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe as the column grows
  useEffect(() => {
    const root = body.current
    const el =
      editingNote === null
        ? null
        : root?.querySelector(`.note[data-note="${editingNote}"]`)
    if (root === null || el === null || el === undefined) {
      setOutOfView(false)
      return
    }
    const seen = new IntersectionObserver(
      ([e]) => setOutOfView(e !== undefined && !e.isIntersecting),
      { root },
    )
    seen.observe(el)
    return () => seen.disconnect()
  }, [editingNote, view.nodes.length])

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
        {p.count > 1 && (
          <button
            aria-keyshortcuts="ArrowLeft ArrowRight Home End"
            aria-label="move column"
            className="grip"
            onKeyDown={e => {
              const to = keyMove(p.position, p.count, e.key)
              if (to === null) return
              e.preventDefault()
              movedByKey.current = true
              p.onMove(to)
            }}
            ref={grip}
            title="drag to move · ← → Home End"
            type="button"
          >
            ⠿
          </button>
        )}
        <span className="fork-label">
          {fork === undefined
            ? fresh
              ? p.column.asksAgent === true
                ? "new · with the agent"
                : "new chat"
              : "thread"
            : `from ${forkLabel}: “${forkText}”`}
        </span>
        {where !== null && (
          <span
            className="where"
            data-thread={threadName}
            title="this thread's name, and where its agent works"
          >
            {where}
          </span>
        )}
        {offer !== null && lane.kind === "lane" && (
          <OfferLine act={act} lane={lane.name} view={offer} />
        )}
        <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={p.seenBy} />
        {p.closable && (
          <button className="close" onClick={p.onClose} type="button">
            close
          </button>
        )}
      </header>
      <div className="column-body" ref={body}>
        {stillEdited && outOfView && (
          <button
            className="note-bar"
            onClick={() =>
              body.current
                ?.querySelector(`.note[data-note="${editingNote}"]`)
                ?.scrollIntoView({ block: "nearest" })
            }
            type="button"
          >
            editing a {edited.state === "draft" ? "draft" : "note"} · back to it
          </button>
        )}
        {/* `useFollow` watches its height. Keep it unpositioned: it would
            become the messages' offsetParent, and `alignOnOpen` measures
            their offsetTop against the body's. */}
        <div className="column-content" ref={content}>
          {/* Room above the first message, so opening can bring it level with
            its fork point even when the column is short. */}
          <div className="spacer" ref={spacer} />
          {view.nodes.map((node, i) => {
            const id = entryId(node.id)
            return (
              <Message
                cites={p.refs.from.get(id) ?? []}
                citedBy={p.refs.to.get(id) ?? []}
                closedBranches={node.branches.filter(
                  b => !p.shown.has(b.rootId),
                )}
                forkTracks={p.forks.get(node.id) ?? []}
                joined={node.id === joinedAt}
                key={node.id}
                nameOf={p.nameOf}
                node={node}
                note={(() => {
                  const note = noteOf.get(node.id)
                  return note === undefined ? undefined : card(note)
                })()}
                onEdit={
                  noteOf.has(node.id) || !writable
                    ? undefined
                    : () => void p.session.note({ kind: "open", entry: id })
                }
                onBranch={
                  // Below a conversation's last message, a branch would be
                  // the same as replying. Agent work follows its lane, so
                  // there a branch at the end is a thread of its own.
                  !writable ||
                  (i === view.nodes.length - 1 && lane.kind !== "lane")
                    ? undefined
                    : {
                        title: "open a branch here",
                        go: () => p.onBranch(node.id, branchPrefill(lane)),
                      }
                }
                // A citation is written where its author reads: here.
                onCite={
                  writable
                    ? (to: ReferenceTarget) =>
                        void p.session.cite(
                          to,
                          view.tipId === null
                            ? ROOT
                            : atEntry(entryId(view.tipId)),
                        )
                    : undefined
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
                {h.kind === "update"
                  ? displayName(h.by, p.nameOf.get(h.by))
                  : withContributors(
                      speakerLabel(
                        p.nameOf,
                        h.details.author,
                        h.details.authorName,
                      ),
                      (h.details.contributors ?? []).map(w =>
                        displayName(w, p.nameOf.get(w)),
                      ),
                    )}{" "}
                · waiting · {n + 1} of {waiting.length}
              </span>
              {h.kind === "update" ? (
                <div className="update-waiting">merging your work</div>
              ) : (
                <MessageText mode="committed" text={h.details.text} />
              )}
            </div>
          ))}
        </div>
        {end.unseen && (
          <div className="jump-slot">
            <button className="jump-latest" onClick={end.follow} type="button">
              ↓ new below
            </button>
          </div>
        )}
      </div>
      {/* The thread's draft (ADR-0025): one per thread end, shared by all. */}
      {draft !== undefined &&
        (joined === draft.id ||
        draft.openedBy === p.session.writer ||
        draft.contributors.includes(p.session.writer) ? (
          <div className="draft-slot">{card(draft)}</div>
        ) : (
          <div className="draft-slot draft-invite">
            {displayName(draft.openedBy, p.nameOf.get(draft.openedBy))} is
            drafting the next message ·{" "}
            <button
              className="join-draft"
              onClick={() => setJoined(draft.id)}
              type="button"
            >
              join
            </button>
          </div>
        ))}
      <Composer
        asksAgent={p.column.asksAgent === true}
        defaultWork={defaultWork}
        project={p.work.project}
        commands={p.work.commands}
        usedDirs={[
          ...new Set(
            [...p.work.lanes.values()].flatMap(r =>
              r.work.kind === "direct" ? [r.work.dir] : [],
            ),
          ),
        ]}
        at={at}
        boundLane={p.column.lane}
        fresh={fresh}
        holderName={holder}
        initialText={p.column.fresh?.prefill}
        lane={lane}
        onBranchInstead={text => {
          if (at.kind === "entry") p.onBranchInstead(at.id, text)
        }}
        onSend={() => {
          end.follow()
          if (!fresh) return undefined
          const id = crypto.randomUUID()
          p.onSent(id)
          return id
        }}
        onComposeTogether={
          fresh || draft !== undefined || !writable
            ? undefined
            : text =>
                void p.session.note({
                  kind: "draft",
                  at,
                  lane: p.column.lane ?? null,
                  text,
                })
        }
        onTyping={p.onTyping}
        participants={p.participants}
        pending={p.column.fresh?.pending}
        prefill={prefill}
        readOnly={p.readOnly}
        typing={p.typing.map(w => nameFor(p.nameOf, w))}
        session={p.session}
      />
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
            <MessageText mode="streaming" text={s.text} />
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

/** A running tool's output, following its end as a column does. */
function LiveOutput({ text }: { text: string }) {
  const pre = useRef<HTMLPreElement>(null)
  const inner = useRef<HTMLElement>(null)
  useFollow(pre, inner)
  return (
    <pre className="tool-output" ref={pre}>
      <code className="tool-output-text" ref={inner}>
        {text}
      </code>
    </pre>
  )
}

/** What a lane is running now, as its offer cares: a turn, a resolution, a split. */
function activityOf(
  index: TreeIndex,
  view: LaneView | undefined,
): OfferActivity {
  if (view === undefined || !view.running) return "idle"
  const prompt = promptOf(index, view.tip)
  const role =
    prompt === null ? undefined : index.entries[prompt]?.message?.role
  return role === "land" ? "resolution" : role === "stack" ? "split" : "turn"
}

const BUTTON_LABEL: Record<OfferButton, string> = {
  take: "take",
  split: "split into a stack",
  squash: "squash to one",
  describe: "rewrite description",
  refresh: "refresh (discards your edits)",
  resolve: "resolve in the thread",
  update: "update from my work",
}

/**
 * A lane's offer in your repo, in its column's header (ADR-0038): its line,
 * its buttons, and a menu for the rest. The bookmark it names is the one to
 * look for in jj or jjui.
 */
function OfferLine({
  view,
  lane,
  act,
}: {
  view: OfferView
  lane: string
  act: (button: OfferButton) => void
}) {
  const label = (b: OfferButton) =>
    b === "take" && view.state === "stack"
      ? "take stack"
      : b === "take" && view.state === "stale"
        ? "take stack and the rest"
        : b === "take" &&
            (view.state === "conflicts" || view.state === "needs_you")
          ? "take anyway"
          : b === "split" && view.state === "stale"
            ? "split again"
            : BUTTON_LABEL[b]
  return (
    <span className="offer" data-lane={lane} data-state={view.state}>
      {view.line !== "" && <span className="offer-line">{view.line}</span>}
      {view.buttons.map(b => (
        <button
          className={`offer-${b}`}
          key={b}
          onClick={() => act(b)}
          type="button"
        >
          {label(b)}
        </button>
      ))}
      {view.menu.length > 0 && (
        <Menu
          className="offer-more"
          items={view.menu.map(b => ({
            key: b,
            label: BUTTON_LABEL[b],
            className: `offer-${b}`,
            onChoose: () => act(b),
          }))}
          label="more for this thread's offer"
          title="this thread's offer"
          trigger="⋯"
          triggerClassName="offer-more-trigger"
        />
      )}
    </span>
  )
}
