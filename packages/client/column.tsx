// client/column — one open path, read top to bottom, with its own scroll.

import { useSelector } from "@kyneta/react"
import {
  type AgentRun,
  atEntry,
  type CardPlace,
  type CardRecord,
  type ColumnView,
  type EntryId,
  entryId,
  type LaneView,
  type NoteId,
  type NoteRecord,
  nearestRevision,
  type Position,
  ROOT,
  type SeatRecord,
  type ThreadLane,
  type TreeIndex,
  threadOf,
  type WriterId,
  workFor,
} from "@pineta/core"
import {
  displayName,
  draftingAt,
  type Held,
  type OfferButton,
  yourCard,
} from "@pineta/marginalia"
import {
  readStreamText,
  type SessionDocHandle,
  type StreamRecord,
} from "@pineta/schema"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { CardEditor } from "./card-editor.tsx"
import {
  AGENT_MARK,
  columnView,
  type HeadBanner,
  type HeadIdentity,
  type HeadOrigin,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
import type { Column as ColumnSpec, Pending, Prefill } from "./columns.ts"
import { Composer, type ReadOnly } from "./composer.tsx"
import { behind, type SeenEnd } from "./follow.ts"
import type { LiveWork } from "./live.ts"
import { Menu } from "./menu.tsx"
import { MessageList } from "./message-list.tsx"
import { MessageText } from "./message-text.tsx"
import type { MessageAct } from "./message-tools.ts"
import { speakerLabel, withContributors } from "./names.ts"
import { Avatars } from "./presence.tsx"
import { colorSlot, trackStyle } from "./rail.tsx"
import { keyMove } from "./reorder.ts"
import { ReviewPane } from "./review-pane.tsx"
import type { ScreenMemory } from "./screen-memory.ts"
import type { SessionClient } from "./session-view.ts"
import type { RowMemory } from "./tool-row.ts"
import { useFollow } from "./use-follow.ts"
import { useSeenBy } from "./use-presence.ts"
import { useStable } from "./use-stable.ts"

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
  /** Display names by writer. */
  nameOf: ReadonlyMap<WriterId, string>
  /** Everyone who can be mentioned (`readParticipants`). */
  participants: readonly string[]
  /**
   * Whether its header and composer show who else follows and types here
   * (ADR-0024): not in the Archive tab's preview.
   */
  showsPresence: boolean
  /** Each person's colour (`presenceColors`). */
  colorOf: (writer: WriterId) => string
  /** This window is typing in this column's composer. */
  onTyping: () => void
  /** Every note's record (ADR-0025). */
  notes: readonly NoteRecord[]
  /** The note drawn with each message (`messageNotes`). */
  notesOf: ReadonlyMap<string, NoteRecord>
  /** Every card's record (ADR-0048). */
  cards: readonly CardRecord[]
  /** Every seat the host has seen: who wrote in a card. */
  seats: readonly SeatRecord[]
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  /** The streams to draw, from the same moment as `index` (`liveWork`). */
  live: LiveWork
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
  onBranch: (at: string, prefill: Prefill | undefined) => void
  /** Open a new tab, its composer starting with `prefill`. */
  onNewTab: (prefill: Prefill, asksAgent: boolean) => void
  /**
   * After a conflict: a fresh column at `at`, which sends the text there and
   * spends its card. A conflict needs a reply at an entry: a `branch` never
   * conflicts.
   */
  onBranchInstead: (at: EntryId, pending: Pending) => void
  /** Nothing may be written here (ADR-0029): no composer, no tools that write. */
  readOnly: ReadOnly | null
  /** A fresh column's first send, by id. */
  onSent: (sendId: string) => void
  /**
   * Whether the column keyed `key` was just opened, so its composer takes
   * focus. True once per opening.
   */
  takeFocus: (key: string) => boolean
  onOpen: (anchor: string) => void
  /** Move this column to index `to`, from its grip's keys (`keyMove`). */
  onMove: (to: number) => void
  onClose: () => void
  /**
   * Whether "close" does anything: not on a root tab's only column, which the
   * root would give back at once (`columnsOf`), nor in a preview.
   */
  closable: boolean
  /**
   * What each column knew of its end when last unmounted, by its key
   * (`follow.ts`). None in the Archive preview.
   */
  seenEnd?: ScreenMemory<SeenEnd>
  /** Each tool row's state, by its call's id, across unmounts. */
  rows: ScreenMemory<RowMemory>
}

export function Column(p: ColumnProps) {
  const { view, index } = p
  const body = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const floor = useRef<HTMLDivElement>(null)

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

  // The lanes running on this column's path stream here.
  const streamingLanes = p.activity
    .filter(r => p.path.has(r.tip))
    .map(r => r.lane)
  // Mounted again (its tab shown again) past the end its reader saw, it shows
  // ↓ new below wherever `alignOnOpen` places it short of its end.
  const [mountedBehind] = useState(() =>
    behind(p.seenEnd?.get(p.column.key), view.tipId),
  )
  const leave = useStable((unseen: boolean) =>
    p.seenEnd?.remember(p.column.key, { tip: view.tipId, unseen }),
  )
  // While they do, the column does not get shorter at its end (S35).
  const end = useFollow(
    body,
    content,
    { floor, holding: streamingLanes.length > 0 },
    { unseen: mountedBehind, leave },
  )
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
  const running = lane.kind === "lane" && lane.running
  const waiting =
    lane.kind === "lane" ? p.outbox.filter(h => h.lane === lane.name) : []
  // Whether this column's next send would create a lane: the composer's to
  // decide, as it is typed.
  const [createsLane, setCreatesLane] = useState(false)
  const shows = columnView({
    index,
    view,
    lane,
    createsLane,
    writable,
    nameOf: p.nameOf,
    lanes: p.lanes,
    work: p.work,
  })
  // The banner drawn as the column mounts shows at once; one arriving later,
  // a new one, fades in.
  const [mountBanner] = useState(() => shows.banner?.url ?? null)
  // The review of the offer beside the thread (ADR-0047): your choice, kept
  // only while the column is mounted. Reset when the offer goes, so the
  // thread's next offer does not open it with nobody asking.
  const review = shows.strip.kind === "offer" ? shows.strip.review : null
  const [reviewing, setReviewing] = useState(false)
  // Reset in render, not an effect: no frame draws a review that is gone.
  if (review === null && reviewing) setReviewing(false)
  const reviewId = `review-${p.column.key}`
  const toggleReview = useStable(() => setReviewing(r => !r))
  const closeReview = useStable(() => setReviewing(false))
  // An update's intent, put in this column's composer (ADR-0038).
  const [insert, setInsert] = useState<{
    readonly text: string
    readonly key: number
  } | null>(null)
  const act = (button: OfferButton) => {
    if (lane.kind !== "lane") return
    if (button === "update" || button === "resolve")
      void p.session.update(lane.name).then(outcome => {
        if (outcome.kind === "updated" && outcome.text !== "")
          setInsert({ text: outcome.text, key: Date.now() })
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

  // The cards at this column's end (ADR-0048): yours, which the composer
  // edits, and everyone else's, drawn above it. A thread's cards are found
  // by where its thread ends now; a fresh column's by its key.
  const threadEnd =
    thread.kind === "thread" && thread.end.kind === "entry"
      ? thread.end.id
      : null
  const mine = fresh
    ? yourCard(
        p.session.writer,
        { kind: "fresh", column: p.column.key },
        p.cards,
        p.lanes,
        index,
      )
    : threadEnd === null
      ? undefined
      : yourCard(
          p.session.writer,
          { kind: "end", end: threadEnd },
          p.cards,
          p.lanes,
          index,
        )
  const others =
    fresh || threadEnd === null
      ? []
      : draftingAt(threadEnd, p.cards, p.lanes, index).filter(
          c => c.owner !== p.session.writer,
        )
  const place: CardPlace | undefined = fresh
    ? { kind: "fresh", column: p.column.key }
    : at.kind === "entry"
      ? { kind: "drafting", at, lane: p.column.lane ?? null }
      : undefined
  // Closing a fresh column that holds your card asks first: its card has no
  // other place, and discarding it is final (ADR-0048).
  const [askClose, setAskClose] = useState(false)
  const close = () => {
    const typed =
      fresh && mine !== undefined
        ? p.session.cardText(mine.id).text().trim() !== ""
        : false
    if (typed) setAskClose(true)
    else p.onClose()
  }
  // The note this window is editing: while it is scrolled out of view, a bar
  // at the column's top leads back to it.
  const [editingNote, setEditingNote] = useState<NoteId | null>(null)
  const [outOfView, setOutOfView] = useState(false)
  const edited = p.notes.find(n => n.id === editingNote)
  const stillEdited = edited !== undefined && edited.state !== "done"
  // What a message's reader asked for, carried out: the one handler every
  // message shares, so none of them redraws when this column does.
  const onAct = useStable((act: MessageAct) => {
    switch (act.kind) {
      case "note":
        void p.session.note({ kind: "open", entry: act.entry })
        return
      case "branch":
        p.onBranch(act.branch.at, act.branch.prefill)
        return
      case "newTab":
        p.onNewTab(act.prefill, act.asksAgent)
        return
      case "openBranch":
        p.onOpen(act.rootId)
    }
  })

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
      data-reviewing={reviewing || undefined}
      data-track={p.track}
    >
      <div className="column-thread">
        <header
          className="column-head"
          data-color={colorSlot(p.track)}
          style={trackStyle(p.track)}
        >
          <div className="head-row">
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
            <Identity
              banner={shows.banner}
              fade={shows.banner !== null && shows.banner.url !== mountBanner}
              identity={shows.identity}
              onOpen={p.onOpen}
              running={running}
            />
            <span className="head-space" />
            {p.showsPresence && view.tipId !== null && (
              <SeenBy
                colorOf={p.colorOf}
                end={view.tipId}
                index={index}
                nameOf={p.nameOf}
                session={p.session}
              />
            )}
            {p.closable && (
              <button
                aria-label="close column"
                className="close"
                onClick={close}
                title="close column"
                type="button"
              >
                ×
              </button>
            )}
          </div>
          <Origin onOpen={p.onOpen} origin={shows.origin} />
          {askClose && (
            <div className="close-ask">
              discard what you typed?{" "}
              <button
                className="close-discard"
                onClick={() => {
                  if (mine !== undefined) p.session.discardCard(mine.id)
                  setAskClose(false)
                  p.onClose()
                }}
                type="button"
              >
                discard
              </button>{" "}
              <button
                className="close-keep"
                onClick={() => setAskClose(false)}
                type="button"
              >
                keep
              </button>
            </div>
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
              editing a note · back to it
            </button>
          )}
          {/* `useFollow` watches its height. Keep it unpositioned: it would
            become the messages' offsetParent, and `alignOnOpen` measures
            their offsetTop against the body's. */}
          <div className="column-content" ref={content}>
            {/* Room above the first message, so opening can bring it level with
            its fork point even when the column is short. */}
            <div className="spacer" ref={spacer} />
            <MessageList
              forks={p.forks}
              index={index}
              joins={shows.joins}
              lane={lane}
              nameOf={p.nameOf}
              notesOf={p.notesOf}
              onAct={onAct}
              onFocusNote={setEditingNote}
              rows={p.rows}
              session={p.session}
              shown={p.shown}
              tools={p.live.tools}
              view={view}
              writable={writable}
            />
            {streamingLanes.map(l => {
              const reply = p.live.replies.get(l)
              return (
                reply !== undefined && (
                  <Reply doc={p.session.doc} key={reply.id} stream={reply} />
                )
              )
            })}
            {/* Where the agent's next text will appear. It takes no height:
            CSS hides it while a row the work opened runs. */}
            {running && <div aria-hidden className="working-line" />}
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
                  <MessageText
                    images={h.details.images}
                    mode="committed"
                    text={h.details.text}
                  />
                )}
              </div>
            ))}
          </div>
          {/* What the content shrank by while the agent works, up to a third
          of the view (`useFollow`). Not the spacer above: that one lines the
          column up on opening. */}
          <div className="column-floor" ref={floor} />
          {end.unseen && (
            <div className="jump-slot">
              <button
                className="jump-latest"
                onClick={end.follow}
                type="button"
              >
                ↓ new below
              </button>
            </div>
          )}
        </div>
        {/* Everyone else's cards at this end (ADR-0048): shown in full, each
          editable and sendable by anyone here. */}
        {others.length > 0 && (
          <div className="cards">
            {others.map(c => (
              <CardEditor
                asksAgent={p.column.asksAgent === true}
                at={at}
                boundLane={p.column.lane}
                card={c}
                commands={p.work.commands}
                fresh={false}
                insert={null}
                key={c.id}
                lane={lane}
                onBranchInstead={pending => {
                  if (at.kind === "entry") p.onBranchInstead(at.id, pending)
                }}
                onIntent={undefined}
                onSend={() => {
                  end.follow()
                  return undefined
                }}
                onTyping={p.onTyping}
                participants={p.participants}
                pending={undefined}
                place={undefined}
                prefill={undefined}
                readOnly={p.readOnly}
                reader={{ me: p.session.writer, nameOf: p.nameOf }}
                seats={p.seats}
                session={p.session}
                takeFocus={undefined}
                where={undefined}
              />
            ))}
          </div>
        )}
        <WorkStripView
          act={act}
          review={{ id: reviewId, open: reviewing, toggle: toggleReview }}
          strip={shows.strip}
        />
        {writable && running && (
          <button
            className="stop"
            onClick={() => void p.session.stop(lane.name)}
            title="end the agent's turn here; messages waiting are then taken"
            type="button"
          >
            Stop
          </button>
        )}
        <Composer
          asksAgent={p.column.asksAgent === true}
          card={mine}
          place={place}
          seats={p.seats}
          where={{
            defaultWork,
            project: p.work.project,
            usedDirs: [
              ...new Set(
                [...p.work.lanes.values()].flatMap(r =>
                  r.work.kind === "direct" ? [r.work.dir] : [],
                ),
              ),
            ],
          }}
          commands={p.work.commands}
          at={at}
          boundLane={p.column.lane}
          fresh={fresh}
          reader={{ me: p.session.writer, nameOf: p.nameOf }}
          prefill={p.column.fresh?.prefill}
          lane={lane}
          onBranchInstead={pending => {
            if (at.kind === "entry") p.onBranchInstead(at.id, pending)
          }}
          onSend={() => {
            end.follow()
            if (!fresh) return undefined
            const id = crypto.randomUUID()
            p.onSent(id)
            return id
          }}
          onIntent={setCreatesLane}
          onTyping={p.onTyping}
          takeFocus={() => p.takeFocus(p.column.key)}
          participants={p.participants}
          pending={p.column.fresh?.pending}
          insert={insert}
          readOnly={p.readOnly}
          typingAt={p.showsPresence ? view.tipId : null}
          session={p.session}
        />
      </div>
      {reviewing && review !== null && (
        <ReviewPane
          id={reviewId}
          line={shows.strip.kind === "offer" ? shows.strip.words.line : ""}
          onClose={closeReview}
          target={review}
        />
      )}
    </section>
  )
}

/**
 * Others following this column's thread, in its header. It reads presence
 * itself, so a presence write redraws this and not the column.
 */
function SeenBy(p: {
  session: SessionClient
  index: TreeIndex
  end: string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}) {
  const writers = useSeenBy(
    p.session.presence,
    p.session.writer,
    p.index,
    p.end,
  )
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The agent's reply as it is written, in a committed reply's markup, so it
 * wraps the same when its entry replaces it. It reads its own text, so a delta
 * re-renders only this, not the column above it.
 */
function Reply({
  doc,
  stream,
}: {
  doc: SessionDocHandle
  stream: StreamRecord
}) {
  const text = useSelector(
    doc,
    useCallback(
      (d: SessionDocHandle) => readStreamText(d, stream.id),
      [stream.id],
    ),
  )
  return (
    <div className="msg assistant streaming" data-stream={stream.id}>
      <span className="role">agent</span>
      <MessageText mode="streaming" text={text} />
    </div>
  )
}

/**
 * The mark before a thread's name: one fixed square, so the name never
 * moves. It holds the star, and the thread's banner over it when there is
 * one; the star stays in the text either way. The square pulses while the
 * lane runs, banner and all: under a banner the star is hidden.
 */
function ThreadMark({
  banner,
  fade,
  running,
}: {
  banner: HeadBanner | null
  fade: boolean
  running: boolean
}) {
  return (
    <span
      className={running ? "thread-mark pulse" : "thread-mark"}
      title={workingWords(running)}
    >
      {banner === null ? (
        <span className="thread-star">{AGENT_MARK}</span>
      ) : (
        <BannerImage fade={fade} key={banner.url} url={banner.url} />
      )}
    </span>
  )
}

/**
 * A banner over the star. A new one fades in once loaded, the star fading
 * out under it; one there as the column mounts shows at once, with no star.
 * Keyed by its URL, so each new banner fades in.
 */
function BannerImage({ url, fade }: { url: string; fade: boolean }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      <span className="thread-star" data-gone={loaded || !fade || undefined}>
        {AGENT_MARK}
      </span>
      <img
        alt=""
        className="banner"
        data-fade={fade || undefined}
        data-loaded={loaded || undefined}
        draggable={false}
        onLoad={() => setLoaded(true)}
        src={url}
      />
    </>
  )
}

/**
 * Who works in the column: its lane's name, which leads to where the lane
 * started; a lane about to start; or nothing, in a conversation. Its mark
 * pulses while the lane runs.
 */
function Identity({
  identity,
  banner,
  fade,
  onOpen,
  running,
}: {
  identity: HeadIdentity
  banner: HeadBanner | null
  fade: boolean
  onOpen: (id: string) => void
  running: boolean
}) {
  if (identity.kind === "none") return null
  if (identity.kind === "pending")
    return (
      <span className="agent-name pending">
        <ThreadMark banner={null} fade={false} running={running} /> new agent
      </span>
    )
  const { start } = identity
  return (
    <button
      className="agent-name"
      data-thread={identity.name}
      disabled={start === null}
      onClick={() => {
        if (start !== null) onOpen(start)
      }}
      title="where this agent started"
      type="button"
    >
      <ThreadMark banner={banner} fade={fade} running={running} />{" "}
      {identity.name}
    </button>
  )
}

/** Where the column forks, leading back to it. */
function Origin({
  origin,
  onOpen,
}: {
  origin: HeadOrigin
  onOpen: (id: string) => void
}) {
  if (origin.kind === "none") return null
  return (
    <button
      className="origin"
      onClick={() => onOpen(origin.at)}
      title="show where this branch starts"
      type="button"
    >
      <span className="origin-dot" />↰ {origin.speaker}: “{origin.text}”
    </button>
  )
}

/**
 * An offer's bookmark, which a press copies. The clipboard needs a secure
 * context, which an invite link over plain http is not: there, a press
 * selects its text, for you to copy.
 */
function Bookmark({ name }: { name: string }) {
  const self = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(t)
  }, [copied])
  const select = () => {
    const range = document.createRange()
    if (self.current === null) return
    range.selectNodeContents(self.current)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  return (
    <button
      className="offer-bookmark"
      onClick={() => {
        if (!window.isSecureContext) return select()
        navigator.clipboard.writeText(name).then(() => setCopied(true), select)
      }}
      ref={self}
      title={copied ? "copied" : "copy the bookmark, to find it in jj"}
      type="button"
    >
      {name}
    </button>
  )
}

/**
 * What became of the column's files, at its foot (ADR-0040): the lane's offer
 * in your repo (ADR-0038), or where a lane that works directly writes. An
 * offer's line opens its review (ADR-0047); its bookmark, copied, finds it in
 * jj or jjui.
 */
function WorkStripView({
  strip,
  act,
  review,
}: {
  strip: WorkStrip
  act: (button: OfferButton) => void
  review: {
    readonly id: string
    readonly open: boolean
    readonly toggle: () => void
  }
}) {
  if (strip.kind === "none") return null
  if (strip.kind === "direct")
    return (
      <div className="work" data-state="direct">
        <span className="work-line">{strip.line}</span>
        {strip.alsoHere.map(name => (
          <span className="work-warning" key={name}>
            {name} is working here too
          </span>
        ))}
      </div>
    )
  const { words } = strip
  return (
    <div className="work offer" data-state={strip.state}>
      {strip.review === null ? (
        <span className="offer-line">{words.line}</span>
      ) : (
        <button
          aria-controls={review.id}
          aria-expanded={review.open}
          className="offer-line"
          onClick={review.toggle}
          title={review.open ? "close the review" : "review what a take brings"}
          type="button"
        >
          {words.line}
        </button>
      )}
      {strip.bookmark !== null && <Bookmark name={strip.bookmark} />}
      <span className="work-space" />
      {words.buttons.map(({ button, label }) => (
        <button
          className={`offer-${button}`}
          key={button}
          onClick={() => act(button)}
          type="button"
        >
          {label}
        </button>
      ))}
      {words.menu.length > 0 && (
        <Menu
          className="offer-more"
          items={words.menu.map(({ button, label }) => ({
            key: button,
            label,
            className: `offer-${button}`,
            onChoose: () => act(button),
          }))}
          label="more for this thread's offer"
          title="this thread's offer"
          trigger="⋯"
          triggerClassName="offer-more-trigger"
        />
      )}
    </div>
  )
}
