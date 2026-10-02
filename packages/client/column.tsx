// client/column — one open path, read top to bottom, with its own scroll.

import { useSelector } from "@kyneta/react"
import {
  type AgentRun,
  type AskIndex,
  askSpan,
  atEntry,
  type CardPlace,
  type CardRecord,
  type ColumnView,
  type EntryId,
  entryId,
  type LaneView,
  messageAt,
  nearestRevision,
  type Position,
  promptOf,
  ROOT,
  type SeatRecord,
  type StopRecord,
  type ThreadLane,
  type TreeIndex,
  threadOf,
  type WriterId,
  workFor,
} from "@pineta/core"
import {
  type DigestRecord,
  draftingAt,
  type OfferButton,
  queuedOn,
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
  useSyncExternalStore,
} from "react"
import type { ReadOnly } from "./app-view.ts"
import type { FoldMemory } from "./ask-fold.ts"
import { askWords, DENSITIES, type Density, densityWords } from "./ask-words.ts"
import { CardEditor, QueuedCardEditor } from "./card-editor.tsx"
import { alreadySentWords } from "./card-words.ts"
import {
  AGENT_MARK,
  bannerUrl,
  columnView,
  type HeadBanner,
  type HeadIdentity,
  type HeadOrigin,
  headLane,
  identityWords,
  type ReserveStep,
  type ReviewTarget,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
import type { Column as ColumnSpec, Pending } from "./columns.ts"
import { Composer } from "./composer.tsx"
import { COPIED, useCopy } from "./copy.ts"
import { behind, type SeenEnd } from "./follow.ts"
import { newCardId, newLaneName } from "./ids.ts"
import type { ColumnAct, Intent } from "./intent.ts"
import { type Left, leftLine } from "./left.ts"
import type { LiveWork } from "./live.ts"
import { Menu } from "./menu.tsx"
import { MessageList } from "./message-list.tsx"
import { MessageText } from "./message-text.tsx"
import { Avatars, nameFor } from "./presence.tsx"
import { colorSlot, trackStyle } from "./rail.tsx"
import { keyMove } from "./reorder.ts"
import { ReviewPane } from "./review-pane.tsx"
import type { ScreenMemory } from "./screen-memory.ts"
import type { ColumnHow, SessionClient } from "./session-view.ts"
import type { DeviceState } from "./tab-state.ts"
import type { RowMemory } from "./tool-row.ts"
import { useAskBar } from "./use-ask-bar.ts"
import { PLACED, useFollow } from "./use-follow.ts"
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
  /** Every card's record (ADR-0048). */
  cards: readonly CardRecord[]
  /** Every seat the host has seen: who wrote in a card. */
  seats: readonly SeatRecord[]
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  /** The streams to draw, from the same moment as `index` (`liveWork`). */
  live: LiveWork
  lanes: readonly LaneView[]
  /** Where lanes work, the files at each entry, and landings (ADR-0032). */
  work: WorkFacts
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<string>
  /**
   * What a reader asks of the page. The column's own acts go as
   * `{ kind: "column", position, act }`, a message's among them.
   */
  onIntent: (intent: Intent) => void
  /** Nothing may be written here (ADR-0029): no composer, no tools that write. */
  readOnly: ReadOnly | null
  /**
   * Whether the column keyed `key` was just opened, so its composer takes
   * focus. True once per opening.
   */
  takeFocus: (key: string) => boolean
  /** Whether × shows (`ColumnSlot.closable`); never in a preview. */
  closable: boolean
  /**
   * What each column knew of its end when last unmounted, by its key
   * (`follow.ts`). None in the Archive preview.
   */
  seenEnd?: ScreenMemory<SeenEnd>
  /** Each tool row's state, by its call's id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  asks: AskIndex
  /** What the rail draws apart in this column's root, sorted: no fold hides it. */
  landmarks: readonly string[]
  /** Who stopped each ask, by its prompt (ADR-0056). */
  stops: ReadonlyMap<string, StopRecord>
  /** Each ask's fold, as the reader chose it, across unmounts. */
  folds: FoldMemory
  /** Each ask's model-written digest, by its prompt (ADR-0056). */
  digests: ReadonlyMap<string, DigestRecord>
  /** Where this device last left each thread (ADR-0056); none in a preview. */
  left?: DeviceState<Left>
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
  // What this column's reader asks, a message's acts among it: the one
  // handler every message shares, so none of them redraws when this column
  // does.
  const act = useStable((act: ColumnAct) =>
    p.onIntent({ kind: "column", position: p.position, act }),
  )
  const openAt = useStable((entry: string) =>
    p.onIntent({ kind: "openAt", entry }),
  )

  // The lanes running on this column's path stream here.
  const streamingLanes = p.activity
    .filter(r => p.path.has(r.tip))
    .map(r => r.lane)
  // Mounted again (its tab shown again) past the end its reader saw, it shows
  // ↓ new below wherever `alignOnOpen` places it short of its end.
  const [mountedBehind] = useState(() =>
    behind(p.seenEnd?.get(p.column.key), view.tipId),
  )
  const [mountedReleased] = useState(
    () => p.seenEnd?.get(p.column.key)?.released ?? null,
  )
  // Where this device last left the thread: read as the column mounts and
  // when the page shows again, so the line stays where it was while you
  // read below it (ADR-0056).
  const leftLane = p.column.lane ?? null
  const readLeft = useStable(() =>
    leftLane === null ? undefined : p.left?.load()?.get(leftLane),
  )
  const [leftAt, setLeftAt] = useState(readLeft)
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") setLeftAt(readLeft())
    }
    document.addEventListener("visibilitychange", back)
    return () => document.removeEventListener("visibilitychange", back)
  }, [readLeft])
  // Leaving, the column remembers its end, and a column bound to a lane at
  // its end leaves the device a mark there: written only then, so watching
  // writes nothing.
  const leave = useStable(
    (left: {
      readonly unseen: boolean
      readonly released: string | null
      readonly following: boolean
    }) => {
      p.seenEnd?.remember(p.column.key, {
        tip: view.tipId,
        unseen: left.unseen,
        released: left.released,
      })
      if (left.following && leftLane !== null && view.tipId !== null)
        p.left?.save(new Map([[leftLane, view.tipId]]))
    },
  )
  // While they do, the column does not get shorter at its end (S35).
  const end = useFollow(
    body,
    content,
    { floor, holding: streamingLanes.length > 0 },
    { unseen: mountedBehind, released: mountedReleased, leave },
    view.tipId,
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
  // The ask this column's lane is answering (ADR-0056).
  const runningAsk =
    lane.kind === "lane" && lane.running ? promptOf(index, lane.tip) : null
  const density = p.column.density ?? "story"
  const nameFn = (w: WriterId) => nameFor(p.nameOf, w)
  const askLine = (ask: string | null): string | null => {
    const prompt = ask === null ? null : messageAt(index, ask)
    return prompt === null ? null : askWords(prompt, nameFn)
  }
  // Which ask the work at the top belongs to, while its message is out of
  // sight (ADR-0056). Outline draws each ask's line under its message.
  const atTop = useAskBar(body, density !== "outline")
  // The cards queued for this thread's lane, above the line, in the order the
  // host takes them (ADR-0048).
  const queued = lane.kind === "lane" ? queuedOn(p.cards, lane.name) : []
  // Your unqueues here that lost: the host had taken the card (S69).
  const sentAnyway = useSyncExternalStore(
    p.session.alreadySent.subscribe,
    p.session.alreadySent.current,
  ).filter(s => lane.kind === "lane" && s.lane === lane.name)
  const reader = { me: p.session.writer, nameOf: p.nameOf }
  // Whether this column's next send would create a lane: the composer's to
  // decide, as it is typed.
  const [createsLane, setCreatesLane] = useState(false)
  const reserved = p.column.reserved ?? null
  // The banner drawn as the column mounts shows at once; one arriving later,
  // a new one, fades in. The composer reports `createsLane` only after the
  // mount, so a reserved lane's banner counts as there already.
  const [mountedBanner] = useState(() =>
    bannerUrl(headLane(lane, true, reserved), p.work.banners),
  )
  const shows = columnView({
    mountedBanner,
    index,
    view,
    lane,
    createsLane,
    reserved,
    writable,
    nameOf: p.nameOf,
    lanes: p.lanes,
    work: p.work,
  })
  // The thread is named before its first send (ADR-0057). The step changes
  // with the person's typing (`createsLane`) and as the name arrives, so the
  // effect runs once per step, not once per render.
  const carryOut = useStable((step: ReserveStep) => {
    if (step.kind === "mint")
      act({ kind: "reserve", key: p.column.key, lane: newLaneName() })
    else if (step.kind === "ask") void p.session.reserve(step.lane)
  })
  const reserve = shows.reserve
  const reserving = reserve.kind === "ask" ? reserve.lane : reserve.kind
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per step, which `reserving` names
  useEffect(() => carryOut(reserve), [reserving])
  // What every send from this column carries, from any card at its end.
  const how: ColumnHow = {
    asksAgent: p.column.asksAgent === true,
    ...(p.column.lane === undefined ? {} : { lane: p.column.lane }),
    ...(reserved === null ? {} : { reserved }),
  }
  // The review of the offer beside the thread (ADR-0047): your choice, kept
  // only while the column is mounted. Reset when the offer goes, so the
  // thread's next offer does not open it with nobody asking.
  const review = shows.strip.kind === "offer" ? shows.strip.review : null
  const [reviewing, setReviewing] = useState(false)
  // Reset in render, not an effect: no frame draws a review that is gone.
  if (review === null && reviewing) setReviewing(false)
  // Or an ask's files, from its digest line (ADR-0056): one review at a time.
  const [askReview, setAskReview] = useState<{
    readonly ask: string
    readonly target: ReviewTarget
  } | null>(null)
  const reviewId = `review-${p.column.key}`
  const toggleReview = useStable(() => {
    setAskReview(null)
    setReviewing(r => !r)
  })
  const closeReview = useStable(() => {
    setAskReview(null)
    setReviewing(false)
  })
  const reviewAsk = useStable((ask: EntryId) => {
    const span = askSpan(index, p.asks, ask, p.work.revisions)
    const lane = p.work.revisions.get(ask)?.lane
    if (span === null || lane === undefined) return
    setReviewing(false)
    setAskReview(r =>
      r?.ask === ask
        ? null
        : {
            ask,
            target: {
              lane,
              spans: [span],
              conflicts: [],
              yourEdits: [],
              title: askLine(ask) ?? undefined,
            },
          },
    )
  })
  // Bringing the thread up to date is a command on your card here (ADR-0055):
  // the one you have at its end, or a new one, focused, so you write what the
  // agent should do with the new work.
  const actOnOffer = (button: OfferButton) => {
    if (lane.kind !== "lane") return
    if (button !== "update" && button !== "resolve")
      return act({ kind: "offer", lane: lane.name, action: button })
    if (place?.kind !== "drafting") return
    act({
      kind: "bringUpToDate",
      key: p.column.key,
      card: mine?.id ?? null,
      create: {
        id: newCardId(),
        owner: p.session.writer,
        place,
        command: null,
        unsent: null,
      },
    })
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
  // Every drafting card here but the composer's: everyone else's, and any
  // other of yours, such as one someone unqueued while you typed this one.
  const others =
    fresh || threadEnd === null
      ? []
      : draftingAt(threadEnd, p.cards, p.lanes, index).filter(
          c => c.id !== mine?.id,
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
    else act({ kind: "close", discard: null })
  }
  const branchInstead = (pending: Pending) => {
    if (at.kind === "entry") act({ kind: "branchInstead", at: at.id, pending })
  }

  return (
    <section
      className="column"
      data-density={density}
      data-key={p.column.key}
      data-position={p.position}
      data-reviewing={reviewing || askReview !== null || undefined}
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
                  act({ kind: "move", to })
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
              identity={shows.identity}
              onOpen={openAt}
              running={running}
              working={workingWords(running, askLine(runningAsk))}
            />
            <span className="head-space" />
            {view.nodes.length > 0 && (
              <DensityControl
                density={density}
                onChoose={d => {
                  act({ kind: "density", density: d })
                  // The reader's own move: at the end, it stays there, and
                  // no floor holds the change (`follow.ts`).
                  body.current?.dispatchEvent(new Event(PLACED))
                }}
              />
            )}
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
          <Origin onOpen={openAt} origin={shows.origin} />
          {askClose && (
            <div className="close-ask">
              discard what you typed?{" "}
              <button
                className="close-discard"
                onClick={() => {
                  setAskClose(false)
                  act({ kind: "close", discard: mine?.id ?? null })
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
          {atTop !== null && (
            <div className="ask-bar-slot">
              <button
                className="ask-bar"
                data-ask={atTop.ask}
                data-where={atTop.kind}
                onClick={() => {
                  if (atTop.kind === "elsewhere") return openAt(atTop.ask)
                  body.current
                    ?.querySelector(`.msg[data-entry="${atTop.ask}"]`)
                    ?.scrollIntoView({ block: "start" })
                }}
                title="the message this work answers"
                type="button"
              >
                {atTop.kind === "elsewhere" && "↰ answering "}
                {askLine(atTop.ask)}
              </button>
            </div>
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
              onAct={act}
              rows={p.rows}
              asks={p.asks}
              density={density}
              folds={p.folds}
              landmarks={p.landmarks}
              releasedTip={end.releasedTip}
              revisions={p.work.revisions}
              runningAsk={runningAsk}
              onReviewAsk={reviewAsk}
              digests={p.digests}
              leftBefore={leftLine(
                index,
                leftAt,
                view.nodes.map(n => n.id),
              )}
              stops={p.stops}
              doc={p.session.doc}
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
            CSS hides it while a row the work opened runs, and in outline,
            where the running ask's own line pulses. */}
            {running && <div aria-hidden className="working-line" />}
            {/* Cards queued for this thread's lane, in the order the host takes
            them: not in the tree yet, and editable by anyone until taken. */}
            {queued.map((c, n) => (
              <QueuedCardEditor
                card={c}
                key={c.id}
                n={n}
                onAct={act}
                onTyping={p.onTyping}
                readOnly={p.readOnly}
                reader={reader}
                session={p.session}
              />
            ))}
            {sentAnyway.map(s => (
              <div className="already-sent" key={s.card}>
                {alreadySentWords(s.by, reader)}
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
                at={at}
                card={c}
                commands={p.work.commands}
                fresh={false}
                how={how}
                key={c.id}
                lane={lane}
                onAct={act}
                onBranchInstead={branchInstead}
                onCreatesLane={undefined}
                onIntent={p.onIntent}
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
                reader={reader}
                seats={p.seats}
                session={p.session}
                takeFocus={undefined}
                where={undefined}
              />
            ))}
          </div>
        )}
        <WorkStripView
          act={actOnOffer}
          review={{ id: reviewId, open: reviewing, toggle: toggleReview }}
          strip={shows.strip}
        />
        {writable && running && (
          <button
            className="stop"
            onClick={() => void p.session.stop(lane.name)}
            title="end the agent's turn here; cards queued are then taken"
            type="button"
          >
            Stop
          </button>
        )}
        <Composer
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
          how={how}
          fresh={fresh}
          reader={{ me: p.session.writer, nameOf: p.nameOf }}
          prefill={p.column.fresh?.prefill}
          lane={lane}
          onBranchInstead={branchInstead}
          onSend={() => {
            end.follow()
            if (!fresh) return undefined
            const sendId = crypto.randomUUID()
            act({ kind: "sent", key: p.column.key, sendId })
            return sendId
          }}
          onAct={act}
          onCreatesLane={setCreatesLane}
          onIntent={p.onIntent}
          onTyping={p.onTyping}
          takeFocus={() => p.takeFocus(p.column.key)}
          participants={p.participants}
          pending={p.column.fresh?.pending}
          readOnly={p.readOnly}
          typingAt={p.showsPresence ? view.tipId : null}
          session={p.session}
        />
      </div>
      {askReview !== null ? (
        <ReviewPane
          id={reviewId}
          line="what this ask changed"
          onClose={closeReview}
          target={askReview.target}
        />
      ) : (
        reviewing &&
        review !== null && (
          <ReviewPane
            id={reviewId}
            line={shows.strip.kind === "offer" ? shows.strip.words.line : ""}
            onClose={closeReview}
            target={review}
          />
        )
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
  running,
  working,
}: {
  banner: HeadBanner | null
  running: boolean
  /** Its title while the lane runs (`workingWords`). */
  working: string | undefined
}) {
  return (
    <span
      className={running ? "thread-mark pulse" : "thread-mark"}
      title={working}
    >
      {banner === null ? (
        <span className="thread-star">{AGENT_MARK}</span>
      ) : (
        <BannerImage fade={banner.fade} key={banner.url} url={banner.url} />
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
  onOpen,
  running,
  working,
}: {
  identity: HeadIdentity
  banner: HeadBanner | null
  onOpen: (id: string) => void
  running: boolean
  working: string | undefined
}) {
  if (identity.kind === "none") return null
  if (identity.kind === "pending")
    return (
      <span className="agent-name pending">
        <ThreadMark banner={null} running={running} working={working} />{" "}
        {identityWords(identity)}
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
      <ThreadMark banner={banner} running={running} working={working} />{" "}
      {identityWords(identity)}
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
 * An offer's bookmark, which a press copies. Where it can't be copied, a
 * press selects the bookmark's own text (`useCopy`).
 */
function Bookmark({ name }: { name: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      className="offer-bookmark"
      onClick={e => copy(name, [e.currentTarget])}
      title={copied ? COPIED : "copy the bookmark, to find it in jj"}
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

/**
 * How much of each ask the column draws (ADR-0056): outline, story or raw.
 * The reader's choice, kept with the column, never written.
 */
function DensityControl({
  density,
  onChoose,
}: {
  density: Density
  onChoose: (d: Density) => void
}) {
  return (
    <span className="density" title="how much to show">
      {DENSITIES.map(d => {
        const words = densityWords(d)
        return (
          <button
            aria-pressed={d === density}
            className="density-choice"
            data-density={d}
            key={d}
            onClick={() => onChoose(d)}
            title={words.title}
            type="button"
          >
            {words.label}
          </button>
        )
      })}
    </span>
  )
}
