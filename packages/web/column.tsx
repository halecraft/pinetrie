// web/column — one open path, read top to bottom, with its own scroll.

import { useSelector } from "@kyneta/react"
import {
  type AgentRun,
  type AskIndex,
  atEntry,
  type CardId,
  type CardPlace,
  type CardRecord,
  type CardWidth,
  conflictsAt,
  type DigestRecord,
  type EntryId,
  isThreadId,
  type LaneView,
  laneOf,
  messageAt,
  nearestRevision,
  type Position,
  pinnedInView,
  pinnedOf,
  promptOf,
  ROOT,
  type SeatRecord,
  type StreamRecord,
  type TaskId,
  type TextPlace,
  type ThreadId,
  type ThreadLane,
  type TraceRecord,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import {
  AGENT_MARK,
  askWords,
  bannerUrl,
  behind,
  branchesAt,
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  type ColumnKey,
  type Column as ColumnSpec,
  type ColumnView,
  type ComposerPlacesStore,
  closeAskWords,
  columnMenu,
  columnView,
  composerPlace,
  DENSITIES,
  type Density,
  DISCARD,
  densityWords,
  detailsTitle,
  type EditorState,
  earlierWords,
  FOLD,
  type FoldMemory,
  freshOf,
  type HeadBanner,
  type HeadIdentity,
  type HeadOrigin,
  headLane,
  type Intent,
  identityWords,
  KEEP_IN_INVENTORY,
  keepSpot,
  keptTraces,
  keyMove,
  type LiveWork,
  leftLine,
  linkTo,
  NEW_PIN,
  NEW_PIN_TITLE,
  newPinAt,
  noticeKey,
  noticeWords,
  opens,
  type Pending,
  type ReadOnly,
  type ReserveStep,
  type RowMemory,
  type ScreenMemory,
  type SeenEnd,
  type SpotStore,
  START_WORDS,
  seenBatches,
  shownBy,
  spotOf,
  startedWords,
  type ThreadDetails,
  type ThreadLink,
  traceGroups,
  tracesAt,
  traceWords,
  type ViewportStore,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "@pinetrie/interface"
import {
  effectiveBase,
  type OfferButton,
  pinnedAt,
  queuedOn,
  traceEnd,
  yourCard,
} from "@pinetrie/rules"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import type { AttentionStore } from "@pinetrie/session"
import { drawnPlace, newCardId, type SessionClient } from "@pinetrie/session"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { CardEditor } from "./card-editor.tsx"
import { dragCard } from "./card-frame.tsx"
import { ColumnMenu } from "./column-menu.tsx"
import { Composer } from "./composer.tsx"
import { COPIED, useCopy } from "./copy.ts"
import { Dock } from "./dock.tsx"
import { Menu } from "./menu.tsx"
import { MessageList } from "./message-list.tsx"
import { MessageText } from "./message-text.tsx"
import { useTrackColors } from "./palette-context.ts"
import {
  askReviewTarget,
  type PaneSubject,
  paneKey,
  paneView,
  togglePane,
} from "./pane.ts"
import { Pane } from "./pane.tsx"
import { MessageSource, PaneReach, STREAMING } from "./pane-context.ts"
import { PinnedStrip } from "./pinned-strip.tsx"
import { Avatars, nameFor } from "./presence.tsx"
import { useAskBar } from "./use-ask-bar.ts"
import { PLACED, useFollow } from "./use-follow.ts"
import { useSeenBy } from "./use-presence.ts"
import { useStable } from "./use-stable.ts"
import { useViewport } from "./use-viewport.ts"

export interface ColumnProps {
  session: SessionClient
  /** The column as the reducer holds it: its lane, and whether it is fresh. */
  column: ColumnSpec
  /** The task it is on (ADR-0116): a new tab's, minted as it opened; null before it is known. */
  task: TaskId | null
  /**
   * Which column it is (ADR-0116): its thread's card on the canvas, which
   * folds and moves; a branch not yet sent, or a new tab's column, which
   * close.
   */
  columnKey: ColumnKey
  /** Its card's index on the canvas; -1 with no card. */
  position: number
  /** Its place among the columns drawn whole, as `data-position` says it. */
  drawnAt: number
  /** How many columns wide its card is drawn (ADR-0116); 1 with no card. */
  width: CardWidth
  /** A task's label: what a fork row names a source's task by (ADR-0117). */
  labelOf: (task: TaskId) => string
  /** How many cards the canvas holds: with two or more, a card's column can move. */
  count: number
  view: ColumnView
  index: TreeIndex
  /** This column's colour track: `--track` on the column (`useTrackColors`). */
  track: number
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<EntryId, readonly number[]>
  /** Ids any column of this tab shows: a branch leaving here that is shown needs no button. */
  shown: ReadonlySet<string>
  /** Display names by writer. */
  nameOf: ReadonlyMap<WriterId, string>
  /** Everyone who can be mentioned (`readParticipants`). */
  participants: readonly string[]
  /** Each person's colour (`presenceColors`). */
  colorOf: (writer: WriterId) => string
  /** This window is typing in this column, in the card its box shows. */
  onTyping: (card: CardId | null) => void
  /** Every card's record (ADR-0048). */
  cards: readonly CardRecord[]
  /** The queued cards that are blank messages (`useBlankQueued`): they do not wait. */
  blank: ReadonlySet<CardId>
  /** Every seat the host has seen: who wrote in a card. */
  seats: readonly SeatRecord[]
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  /** The streams to draw, from the same moment as `index` (`liveWork`). */
  live: LiveWork
  lanes: readonly LaneView[]
  /** Where lanes work, the files at each entry, and each lane's offer (ADR-0032). */
  work: WorkFacts
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<EntryId>
  /**
   * What a reader asks of the page. The column's own acts go as
   * `{ kind: "column", key, act }`, a message's among them.
   */
  onIntent: (intent: Intent) => void
  /** Nothing may be written here (ADR-0029): no composer, no tools that write. */
  readOnly: ReadOnly | null
  /**
   * Whether the column keyed `key` was just opened, so its composer takes
   * focus. True once per opening.
   */
  takeFocus: (key: string) => boolean
  /** Whether × shows (`ColumnSlot.closable`). */
  closable: boolean
  /**
   * What each column knew of its end when last unmounted, by its key
   * (`follow.ts`).
   */
  seenEnd: ScreenMemory<SeenEnd>
  /** Each tool row's state, by its call's id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  asks: AskIndex
  /** What the rail draws apart in this column's root, sorted: no fold hides it. */
  landmarks: readonly EntryId[]
  /** Each ask's fold, as the reader chose it, across unmounts. */
  folds: FoldMemory
  /** Each ask's model-written digest, by its prompt (ADR-0106). */
  digests: ReadonlyMap<EntryId, DigestRecord>
  /**
   * How far you have read each thread, on every device of yours (ADR-0106,
   * ADR-0077).
   */
  attention: AttentionStore
  /** Every mounted column's view, which the rail outlines (ADR-0058). */
  viewports: ViewportStore
  /** Where columns were left, by message (ADR-0058). */
  spots: SpotStore
  /**
   * Every trace, by id (ADR-0048): the column draws its reader's own at its
   * thread's end.
   */
  traces: ReadonlyMap<string, TraceRecord>
  /** Each column's composer, which a put on the column reads (`put-target.ts`). */
  composers: ComposerPlacesStore
}

/** The take handle's words: what dropping it on a slot does. */
const TAKE_DRAG =
  "drag onto a slot of your inventory to put this thread away: its run stops"

/** A place a text card may be in; undefined for a canvas. */
const textPlaceOf = (place: CardPlace | undefined): TextPlace | undefined =>
  place === undefined || place.kind === "canvas" ? undefined : place

export function Column(p: ColumnProps) {
  const { index } = p
  // The path above the column's own thread, folded when the thread it forks
  // from is on no column of this canvas (ADR-0117): unfolded, it is drawn
  // as the rest of the path is.
  const [aboveOpen, setAboveOpen] = useState(false)
  const view = useMemo(
    () =>
      aboveOpen && p.view.above.length > 0
        ? { ...p.view, nodes: [...p.view.above, ...p.view.nodes], above: [] }
        : p.view,
    [aboveOpen, p.view],
  )
  const colors = useTrackColors()
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

  // A fresh column, or a copy before its first send: its next send is a
  // branch at its anchor, its thread's first message (ADR-0117).
  const fresh = branchesAt(p.column)
  const freshMode = freshOf(p.column)
  // A card's column folds and moves; a fresh one closes and sends first.
  const { columnKey } = p
  const card = columnKey.kind === "card" ? columnKey.card : null
  const freshKey =
    columnKey.kind === "fresh" || columnKey.kind === "newTab" ? columnKey : null
  // Where a send attaches: a fresh column's branch point, else the column's end.
  const at: Position = fresh
    ? p.column.anchor === null
      ? ROOT
      : atEntry(p.column.anchor)
    : view.tipId === null
      ? ROOT
      : atEntry(view.tipId)
  const writable = p.readOnly === null
  // What this column's reader asks, a message's acts among it: the one
  // handler every message shares, so none of them redraws when this column
  // does.
  const act = useStable((act: ColumnAct) =>
    p.onIntent({ kind: "column", column: p.columnKey, act }),
  )
  const openAt = useStable((entry: EntryId) =>
    p.onIntent({ kind: "openAt", entry }),
  )
  // What the name's `aria-controls` points at.
  const detailsId = `details-${p.column.key}`

  // The lanes running on this column's path stream here.
  const streamingLanes = p.activity
    .filter(r => p.path.has(r.tip))
    .map(r => r.lane)
  // Mounted again (its root shown again) past the end its reader saw, it shows
  // ↓ new below wherever `alignOnOpen` places it short of its end.
  const [mountedBehind] = useState(() =>
    behind(p.seenEnd.get(p.column.key), view.tipId),
  )
  const [mountedReleased] = useState(
    () => p.seenEnd.get(p.column.key)?.released ?? null,
  )
  // Where you last left the thread, on any device: read as the column
  // mounts and when the page shows again, so the line stays where it was
  // while you read below it (ADR-0106, ADR-0077).
  const leftLane = p.column.thread
  const readLeft = useStable(() =>
    p.attention.attention.current().read.get(leftLane),
  )
  const [leftAt, setLeftAt] = useState(readLeft)
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  )
  useEffect(() => {
    const back = () => {
      const now = document.visibilityState === "visible"
      if (now) setLeftAt(readLeft())
      setVisible(now)
    }
    document.addEventListener("visibilitychange", back)
    return () => document.removeEventListener("visibilitychange", back)
  }, [readLeft])
  // Which of its messages are in view, for the rail, and for its spot.
  const ids = useMemo(() => view.nodes.map(n => n.id), [view.nodes])
  const span = useViewport(body, content, {
    key: p.column.key,
    track: p.track,
    ids,
    store: p.viewports,
  })
  // Leaving, the column remembers its end and its spot, and a column bound
  // to a lane at its end marks it read there; the marks waiting are written
  // at once (`AttentionStore.leave`).
  const leave = useStable(
    (left: {
      readonly unseen: boolean
      readonly released: EntryId | null
      readonly following: boolean
    }) => {
      p.seenEnd.remember(p.column.key, {
        tip: view.tipId,
        unseen: left.unseen,
        released: left.released,
      })
      if (left.following && leftLane !== null && view.tipId !== null)
        p.attention.read(leftLane, view.tipId)
      p.attention.leave()
      p.spots.save(
        keepSpot(
          p.spots.load(),
          ids,
          spotOf(span.current, left.following, ids.at(-1)),
        ),
      )
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
  // Watching its end, in a page you can see, you have read the thread to it:
  // a run you watch end raises nothing (ADR-0077). `readStep` decides when
  // the mark is written.
  const attention = p.attention
  useEffect(() => {
    if (attention === undefined || leftLane === null || view.tipId === null)
      return
    if (end.releasedTip === null && visible)
      attention.read(leftLane, view.tipId)
  }, [attention, leftLane, view.tipId, end.releasedTip, visible])
  // This thread's lane, as the host will find it: busy means a compelled
  // message waits.
  // A fresh column's thread starts with its first send: it has no lane yet.
  const lane: ThreadLane = fresh
    ? { kind: "none" }
    : laneOf(p.lanes, p.column.thread)
  const running = lane.kind === "lane" && lane.running
  // The ask this column's lane is answering (ADR-0106).
  const runningAsk =
    lane.kind === "lane" && lane.running ? promptOf(index, lane.tip) : null
  const density = p.column.density ?? "story"
  const nameFn = (w: WriterId) => nameFor(p.nameOf, w)
  const askLine = (ask: EntryId | null): string | null => {
    const prompt = ask === null ? null : messageAt(index, ask)
    return prompt === null ? null : askWords(prompt, nameFn)
  }
  // Which ask the work at the top belongs to, while its message is out of
  // sight (ADR-0106). Outline draws each ask's line under its message.
  const atTop = useAskBar(body, density !== "outline")
  // The cards queued for this thread's lane, above the line, in the order the
  // host pops them (ADR-0048).
  const queued = lane.kind === "lane" ? queuedOn(p.cards, lane.name) : []
  // What you did here that was refused: an unqueue the host had popped the
  // card before (S69), a move someone else made first (ADR-0059), a put the
  // host would not accept, or a keep without room.
  const refused = useSyncExternalStore(
    p.session.moves.subscribe,
    p.session.moves.current,
  ).notices.filter(
    r => r.actedAt.kind === "column" && r.actedAt.key === p.column.key,
  )
  const reader = { me: p.session.writer, nameOf: p.nameOf }
  // Whether this column's next send would create a lane: the composer's to
  // decide, as it is typed.
  const [createsLane, setCreatesLane] = useState(false)
  const thread = p.column.thread
  // The banner drawn as the column mounts shows at once; one arriving later,
  // a new one, fades in. The composer reports `createsLane` only after the
  // mount, so the banner of the lane its next send creates counts as there
  // already.
  const [mountedBanner] = useState(() =>
    bannerUrl(headLane(lane, true, thread), p.work.banners),
  )
  // Whether the reader opened the thread's details here, since the column
  // mounted: they spin only then, and not when a reload or a tab switch
  // mounts them open (ADR-0073), as a banner there at mount does not fade.
  const [openedHere, setOpenedHere] = useState(false)
  const working = workingWords(running, askLine(runningAsk))
  // The cards at this column's end (ADR-0048): yours, which the composer
  // edits, and everyone else's, drawn above it. A thread's cards are found
  // by where its thread ends now; a fresh column's by its key.
  const threadEnd = at.kind === "entry" ? at.id : null
  const mine = fresh
    ? yourCard(
        p.session.writer,
        { kind: "fresh", column: p.column.key },
        p.cards,
        index,
      )
    : threadEnd === null
      ? undefined
      : yourCard(
          p.session.writer,
          { kind: "end", end: threadEnd },
          p.cards,
          index,
        )
  // The thread's pinned cards (ADR-0048 step 5), and what the agent reads of
  // them now, from the walk the host plans a run's cards from. A fresh
  // column has no thread, so none.
  const pinned =
    fresh || threadEnd === null ? [] : pinnedAt(threadEnd, p.cards, index)
  const inView = threadEnd === null ? null : pinnedInView(index, threadEnd)
  // Your last offer command on this lane: in flight, refused or failed.
  const acting = useSyncExternalStore(
    p.session.acting.subscribe,
    p.session.acting.current,
  )
  const origins = useMemo(
    () => ({
      task: p.task,
      linkOf: (t: ThreadId) => linkTo(t, p.cards, p.session.writer),
      labelOf: p.labelOf,
      reader: { me: p.session.writer, nameOf: p.nameOf },
    }),
    [p.task, p.cards, p.session.writer, p.labelOf, p.nameOf],
  )
  const shows = columnView({
    acting:
      lane.kind === "lane" ? (acting.offers.get(lane.name) ?? null) : null,
    mountedBanner,
    queued,
    index,
    asks: p.asks,
    view,
    lane,
    createsLane,
    detailsOpen: p.column.details === true,
    thread,
    writable,
    nameOf: p.nameOf,
    lanes: p.lanes,
    work: p.work,
    origins,
  })
  // What a card's command catches up with: the thread's base (ADR-0104),
  // or the thread it branched from (ADR-0072). One object while what it
  // says is the same: the composer is memoised.
  const baseRecord =
    lane.kind === "lane" ? (p.work.bases.get(lane.name) ?? null) : null
  const parentLane = shows.parent?.lane ?? null
  const parentName = shows.parent?.name ?? null
  const catchUps: CatchUps = useMemo(
    () => ({
      base: effectiveBase(baseRecord),
      parent:
        parentLane === null || parentName === null
          ? null
          : { kind: "parent", lane: parentLane, name: parentName },
    }),
    [baseRecord, parentLane, parentName],
  )
  // The thread is named before its first send (ADR-0057). The step changes
  // with the person's typing (`createsLane`) and as the name arrives, so the
  // effect runs once per step, not once per render.
  const carryOut = useStable((step: ReserveStep) => {
    if (step.kind === "ask")
      void p.session.request({ kind: "reserve", lane: step.lane })
  })
  const reserve = shows.reserve
  const reserving = reserve.kind === "ask" ? reserve.lane : reserve.kind
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per step, which `reserving` names
  useEffect(() => carryOut(reserve), [reserving])
  // What every send from this column carries, from any card at its end.
  const how: ColumnHow = {
    column: p.column.key,
    asksAgent: p.column.asksAgent === true,
    thread,
    task: p.task,
    ...(freshMode?.root === undefined ? {} : { root: freshMode.root }),
    ...(pinned.length === 0 ? {} : { pinned: pinned.map(c => c.id) }),
  }
  // The column's pane (ADR-0078): what you opened beside the thread, kept
  // only while the column is mounted. One subject at a time, named, so
  // `paneView` can tell when it is gone: the offer's review after an
  // acceptance or a withdrawal, a table or an image whose message this column no longer
  // draws. The thread's next offer does not open it with nobody asking.
  const [pane, setPane] = useState<PaneSubject | null>(null)
  const openPane = useStable((subject: PaneSubject) =>
    setPane(shown => togglePane(shown, subject)),
  )
  const closePane = useStable(() => setPane(null))
  const reach = useMemo(
    () => ({ shown: pane, open: openPane }),
    [pane, openPane],
  )
  const review = shows.strip.kind === "offer" ? shows.strip.review : null
  const paneShows =
    pane === null
      ? null
      : paneView(pane, {
          offer:
            review === null || shows.strip.kind !== "offer"
              ? null
              : { target: review, line: shows.strip.words.line },
          nodes: view.nodes,
          askTarget: ask =>
            askReviewTarget(index, p.asks, p.work.revisions, ask, askLine(ask)),
        })
  // Reset in render, not an effect: no frame draws a pane that is gone.
  if (pane !== null && paneShows === null) setPane(null)
  const paneId = `pane-${p.column.key}`
  const toggleReview = useStable(() => openPane({ kind: "offer" }))
  // Catching up and splitting are a card with the command and no text,
  // made in the queue (ADR-0108, ADR-0061, ADR-0080, ADR-0113): the host
  // pops it when the lane is free. An acceptance names its destination: the default,
  // or accepted work (ADR-0104).
  const actOnOffer = (button: OfferButton) => {
    if (lane.kind !== "lane") return
    if (button === "accept" || button === "accept-into-accepted") {
      const destinations =
        shows.strip.kind === "offer" ? shows.strip.destinations : []
      const to =
        button === "accept"
          ? destinations[0]
          : destinations.find(d => d.kind === "accepted")
      if (to === undefined) return
      return act({
        kind: "offer",
        lane: lane.name,
        action: "accept",
        to: to.bookmark,
      })
    }
    if (
      button !== "update" &&
      button !== "continue" &&
      button !== "catch-up-parent" &&
      button !== "split"
    )
      return act({ kind: "offer", lane: lane.name, action: button, to: null })
    if (at.kind !== "entry") return
    act({
      kind: "queueNew",
      card: newCardId(),
      hold: "keep",
      command:
        button === "continue"
          ? "continue-on-accepted"
          : button === "catch-up-parent"
            ? "catch-up-with-parent"
            : button === "split"
              ? "split"
              : "bring-up-to-date",
      lane: lane.name,
      at,
    })
  }
  // What a lane this column's next send creates would start with.
  const above = nearestRevision(index, p.work.revisions, at)
  const forkConflicts =
    above.commit === null ? [] : conflictsAt(p.work.revisions, above.commit)

  const place =
    composerPlace(
      p.column,
      at,
      at.kind === "entry" ? p.session.rootOf(at.id) : undefined,
      p.task,
    ) ?? undefined
  // Where this composer creates your message, and the message there: what
  // a put here reads (`ComposerSpot`). A column that can be written
  // publishes them; one leaving takes them back.
  const { composers } = p
  const key = p.column.key
  useEffect(() => {
    composers.set(
      key,
      writable && place !== undefined
        ? { place, message: mine?.id ?? null }
        : null,
    )
  })
  useEffect(() => () => composers.set(key, null), [composers, key])
  // A send from any card here: a fresh column's first one names the message
  // the column then follows.
  const onSend = () => {
    end.follow()
    if (!fresh) return undefined
    const sendId = crypto.randomUUID()
    if (freshKey !== null)
      p.onIntent({ kind: "sentFresh", column: freshKey, sendId })
    return sendId
  }
  // Where a queue from a card's ⋯ puts it: on this thread's lane, at its end.
  const queueOn =
    lane.kind === "lane" && at.kind === "entry" ? { lane: lane.name, at } : null
  // Where a drop lands: exactly where a put can.
  const putColumn = writable && place !== undefined ? key : null
  const pinKey = writable && place !== undefined ? pinnedOf(place) : null
  const putPinned = pinKey === null ? null : key
  // "+ pin" opens a box that makes a pinned card (ADR-0048). While it is
  // open, the strip leaves out the card it shows, as the column leaves out
  // the composer's. It closes when focus leaves it.
  const [pinning, setPinning] = useState(false)
  const [pinBox, setPinBox] = useState<EditorState | undefined>(undefined)
  const pinShown = pinning && pinBox !== undefined ? shownBy(pinBox) : null
  const newPin = newPinAt({
    canPin: pinKey !== null && !fresh && threadEnd !== null,
    pinning,
    pinned: pinned.length,
  })
  const openPin = () => {
    setPinBox(undefined)
    setPinning(true)
  }
  // Your traces where your cards were at this thread's end, when someone
  // else moved them while you were away (ADR-0048). Drawn in a page you can
  // see, a trace is seen: the host deletes it, and this column keeps drawing
  // what it drew until it unmounts (`keptTraces`). Not in a column that
  // cannot be written: an archived root's is a glance, not a return.
  const watches = writable && threadEnd !== null
  const traces =
    !watches || threadEnd === null
      ? []
      : tracesAt(p.traces.values(), p.session.writer, threadEnd, from =>
          traceEnd(from, index),
        )
  const [keptHere, setKeptHere] = useState<ReadonlyMap<string, TraceRecord>>(
    () => new Map(),
  )
  const traceIds = traces.map(t => t.id).join(" ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the traces here changing, and the page showing
  useEffect(() => {
    if (!visible) return
    const unseen = traces.filter(t => !keptHere.has(t.id))
    if (unseen.length === 0) return
    setKeptHere(
      kept => new Map([...kept, ...unseen.map(t => [t.id, t] as const)]),
    )
    for (const traces of seenBatches(unseen.map(t => t.id)))
      void p.session.request({ kind: "traces-seen", traces })
  }, [traceIds, visible])
  const traceRows = traceGroups(keptTraces(keptHere, traces))
  // Closing a fresh column whose cards hold text asks first: they have no
  // thread to stay on. Keeping them in your inventory is the default, and can
  // be undone; discarding them is final (ADR-0048).
  const [askClose, setAskClose] = useState<readonly CardId[] | null>(null)
  const close = () => {
    const typed = fresh
      ? (mine === undefined ? [] : [mine])
          .filter(c => p.session.cardText(c.id).text().trim() !== "")
          .map(c => c.id)
      : []
    if (typed.length > 0) setAskClose(typed)
    else if (freshKey !== null)
      p.onIntent({ kind: "closeFresh", column: freshKey, discard: [] })
  }
  const branchInstead = (pending: Pending) => {
    if (at.kind === "entry") act({ kind: "branchInstead", at: at.id, pending })
  }

  return (
    <section
      className="column"
      data-card={card ?? undefined}
      data-density={density}
      data-width={p.width}
      data-key={p.column.key}
      data-position={p.drawnAt}
      data-pane={pane?.kind}
      data-track={p.track}
      style={colors.style(p.track)}
    >
      <PaneReach value={reach}>
        <div className="column-thread">
          <header
            className="column-head"
            data-color={colors.slot(p.track)}
            data-column-head={card === null ? undefined : ""}
          >
            <div className="head-row">
              {card !== null && p.count > 1 && (
                <button
                  aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                  aria-label="move column"
                  className="grip"
                  onKeyDown={e => {
                    const to = keyMove(p.position, p.count, e.key)
                    if (to === null) return
                    e.preventDefault()
                    movedByKey.current = true
                    if (columnKey.kind === "card")
                      p.onIntent({ kind: "moveColumn", column: columnKey, to })
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
                detailsId={detailsId}
                identity={shows.identity}
                onToggle={open => {
                  if (open) setOpenedHere(true)
                  // No `PLACED`, unlike density: this changes the viewport's
                  // height, not the content's, and `useFollow`'s resize step
                  // keeps a column at its end there.
                  act({ kind: "details", open })
                }}
                running={running}
                working={working}
              />
              {shows.base !== null && (
                <span className="thread-base">{shows.base}</span>
              )}
              {shows.behind !== null && (
                <span className="thread-behind" title={shows.behind.title}>
                  {shows.behind.mark}
                </span>
              )}
              <span className="head-space" />
              {newPin === "header" && (
                <button
                  className="new-pin"
                  onClick={openPin}
                  title={NEW_PIN_TITLE}
                  type="button"
                >
                  {NEW_PIN}
                </button>
              )}
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
              {view.tipId !== null && (
                <SeenBy
                  colorOf={p.colorOf}
                  end={view.tipId}
                  index={index}
                  nameOf={p.nameOf}
                  session={p.session}
                />
              )}
              {card !== null && isThreadId(card) && (
                // A thread's card dragged onto a slot of your inventory is
                // taken there (ADR-0117, ADR-0124); the header itself drags
                // the column along the canvas.
                <button
                  aria-label={TAKE_DRAG}
                  className="take-drag"
                  draggable
                  onDragStart={e => dragCard(e, card)}
                  title={TAKE_DRAG}
                  type="button"
                >
                  ⇲
                </button>
              )}
              {card !== null && (
                <ColumnMenu
                  onIntent={p.onIntent}
                  sections={columnMenu({ card, width: p.width })}
                />
              )}
              {card !== null && (
                <button
                  aria-label={FOLD.title}
                  className={FOLD.className}
                  onClick={() =>
                    card !== null &&
                    p.onIntent({ kind: "fold", card: card, unfolded: false })
                  }
                  title={FOLD.title}
                  type="button"
                >
                  {FOLD.label}
                </button>
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
            <Origin
              onLink={(link, at) =>
                p.onIntent({ kind: "openLink", link, entry: at })
              }
              onOpen={openAt}
              origin={shows.origin}
            />
            {view.above.length > 0 && (
              <button
                className="earlier"
                onClick={() => setAboveOpen(true)}
                title="show the path above this thread"
                type="button"
              >
                {earlierWords(view.above.length)}
              </button>
            )}
            {/* The work strip, a row of the header (ADR-0113). */}
            <WorkStripView
              act={actOnOffer}
              review={{
                id: paneId,
                open: pane?.kind === "offer",
                toggle: toggleReview,
              }}
              strip={shows.strip}
            />
            {askClose !== null && (
              <div className="close-ask">
                {closeAskWords(askClose.length)}{" "}
                <button
                  // biome-ignore lint/a11y/noAutofocus: the default answer to the ask just shown
                  autoFocus
                  className="close-keep"
                  onClick={() => {
                    setAskClose(null)
                    if (freshKey !== null)
                      p.onIntent({
                        kind: "keepFresh",
                        column: freshKey,
                        cards: askClose,
                      })
                  }}
                  type="button"
                >
                  {KEEP_IN_INVENTORY}
                </button>{" "}
                <button
                  className="close-discard"
                  onClick={() => {
                    setAskClose(null)
                    if (freshKey !== null)
                      p.onIntent({
                        kind: "closeFresh",
                        column: freshKey,
                        discard: askClose,
                      })
                  }}
                  type="button"
                >
                  {DISCARD}
                </button>{" "}
                <button
                  className="close-cancel"
                  onClick={() => setAskClose(null)}
                  type="button"
                >
                  cancel
                </button>
              </div>
            )}
          </header>
          {shows.identity.kind === "agent" && shows.identity.details.open && (
            <ThreadDetailsPanel
              banner={shows.banner}
              details={shows.identity.details}
              id={detailsId}
              name={shows.identity.name}
              onOpen={openAt}
              running={running}
              spinFirst={openedHere}
              working={working}
            />
          )}
          {!fresh && threadEnd !== null && (
            <PinnedStrip
              box={
                pinning && pinKey !== null ? (
                  <CardEditor
                    at={at}
                    card={pinned.find(c => c.id === pinShown)}
                    catchUps={catchUps}
                    commands={[]}
                    fresh={false}
                    how={how}
                    lane={lane}
                    onAct={act}
                    onBranchInstead={branchInstead}
                    onCreatesLane={undefined}
                    onIntent={p.onIntent}
                    onLeave={() => setPinning(false)}
                    onSend={onSend}
                    onShows={setPinBox}
                    onTyping={p.onTyping}
                    participants={p.participants}
                    pending={undefined}
                    place={textPlaceOf(
                      drawnPlace(pinKey, p.session.writer, p.cards),
                    )}
                    prefill={undefined}
                    readOnly={p.readOnly}
                    reader={reader}
                    session={p.session}
                    takeFocus={() => true}
                    where={undefined}
                  />
                ) : null
              }
              cards={pinned.filter(c => c.id !== pinShown)}
              catchUps={catchUps}
              inView={inView}
              onNewPin={newPin === "strip" ? openPin : null}
              onAct={act}
              onTyping={p.onTyping}
              putKey={putPinned}
              queueOn={queueOn}
              readOnly={p.readOnly}
              reader={reader}
              session={p.session}
            />
          )}
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
                digests={p.digests}
                leftBefore={leftLine(
                  index,
                  leftAt,
                  view.nodes.map(n => n.id),
                )}
                live={p.session.live}
                shown={p.shown}
                tools={p.live.tools}
                view={view}
                writable={writable}
              />
              {streamingLanes.map(l => {
                const reply = p.live.replies.get(l)
                return (
                  reply !== undefined && (
                    <Reply doc={p.session.live} key={reply.id} stream={reply} />
                  )
                )
              })}
              {/* Where the agent's next text will appear. It takes no height:
            CSS hides it while a row the work opened runs, and in outline,
            where the running ask's own line pulses. */}
              {running && <div aria-hidden className="working-line" />}
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
          {traceRows.length > 0 && (
            <div className="traces">
              {traceRows.map(g => {
                const last = g.traces.at(-1)
                return (
                  last !== undefined && (
                    <button
                      className="trace"
                      data-trace={g.traces.map(t => t.id).join(" ")}
                      key={last.id}
                      onClick={() =>
                        p.onIntent({ kind: "openTrace", trace: last })
                      }
                      title="show where it is now"
                      type="button"
                    >
                      {traceWords(g, reader)}
                    </button>
                  )
                )
              })}
            </div>
          )}
          <Dock
            asks={p.asks}
            blank={p.blank}
            cards={p.cards}
            catchUps={catchUps}
            index={index}
            lane={lane.kind === "lane" ? lane : null}
            notices={refused.map(r => (
              <div className="refused-move" key={noticeKey(r)}>
                {noticeWords(r, reader)}
              </div>
            ))}
            onAct={act}
            onTyping={p.onTyping}
            queueAt={queueOn}
            queued={queued}
            readOnly={p.readOnly}
            reader={reader}
            session={p.session}
          >
            <Composer
              card={mine}
              place={place}
              where={{
                accepted: p.work.accepted,
                forkConflicts: forkConflicts.length,
              }}
              commands={p.work.commands}
              at={at}
              how={how}
              fresh={fresh}
              reader={{ me: p.session.writer, nameOf: p.nameOf }}
              prefill={freshMode?.prefill}
              lane={lane}
              onBranchInstead={branchInstead}
              onSend={onSend}
              onAct={act}
              onCreatesLane={setCreatesLane}
              onIntent={p.onIntent}
              onTyping={p.onTyping}
              takeFocus={() => p.takeFocus(p.column.key)}
              catchUps={catchUps}
              putColumn={putColumn}
              participants={p.participants}
              pending={freshMode?.pending}
              readOnly={p.readOnly}
              typingAt={view.tipId}
              session={p.session}
            />
          </Dock>
        </div>
        {pane !== null && paneShows !== null && (
          <Pane
            close={closePane}
            id={paneId}
            key={paneKey(pane)}
            track={p.track}
            view={paneShows}
          />
        )}
      </PaneReach>
    </section>
  )
}

/**
 * Others reading this column's thread, in its header. It reads presence
 * itself, so a presence write redraws this and not the column.
 */
function SeenBy(p: {
  session: SessionClient
  index: TreeIndex
  end: EntryId
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
function Reply({ doc, stream }: { doc: LiveDocHandle; stream: StreamRecord }) {
  const text = useSelector(
    doc,
    useCallback(
      (d: LiveDocHandle) => readStreamText(d, stream.id),
      [stream.id],
    ),
  )
  return (
    <MessageSource value={STREAMING}>
      <div className="msg assistant streaming" data-stream={stream.id}>
        <span className="role">agent</span>
        <MessageText mode="streaming" text={text} />
      </div>
    </MessageSource>
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
 * Who works in the column: its lane's name, which opens or closes the
 * thread's details (ADR-0073); a lane about to start; or nothing, in a
 * conversation. Its mark pulses while the lane runs. The name's chevron is
 * CSS, so its text is the mark and the name alone.
 */
function Identity({
  identity,
  banner,
  detailsId,
  onToggle,
  running,
  working,
}: {
  identity: HeadIdentity
  banner: HeadBanner | null
  /** The details' element id, for `aria-controls`. */
  detailsId: string
  onToggle: (open: boolean) => void
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
  const { open } = identity.details
  return (
    <button
      aria-controls={open ? detailsId : undefined}
      aria-expanded={open}
      className="agent-name"
      data-thread={identity.name}
      onClick={() => onToggle(!open)}
      title={detailsTitle(open)}
      type="button"
    >
      <ThreadMark banner={banner} running={running} working={working} />{" "}
      {identityWords(identity)}
    </button>
  )
}

/**
 * A named thread's details, under its header (ADR-0073): its mark
 * magnified, its name, who started it, what it works on
 * now, whether its base has moved on, and where its lane started on this
 * path. The mark is `ThreadMark` itself, scaled by CSS. It spins as the
 * reader opens the details here (`spinFirst`) and at each click; mounted
 * open, by a reload or a tab switch, it stays still. The spin is on the
 * button around the mark, since the mark's own transform pulses while the
 * lane runs.
 */
function ThreadDetailsPanel({
  banner,
  details,
  id,
  name,
  onOpen,
  running,
  spinFirst,
  working,
}: {
  banner: HeadBanner | null
  details: ThreadDetails
  id: string
  name: string
  onOpen: (id: EntryId) => void
  running: boolean
  spinFirst: boolean
  working: string | undefined
}) {
  const [spins, setSpins] = useState(spinFirst ? 1 : 0)
  const [now] = useState(() => Date.now())
  const { started, behind, start } = details
  return (
    <section aria-label={name} className="thread-details" id={id}>
      <button
        aria-label="spin"
        className="thread-details-icon"
        // Each spin changes the animation's name, which restarts it without
        // drawing the mark again: a new banner would fade in again.
        data-spin={spins === 0 ? undefined : spins % 2 === 1 ? "odd" : "even"}
        onClick={() => setSpins(n => n + 1)}
        type="button"
      >
        <ThreadMark banner={banner} running={running} working={working} />
      </button>
      <div className="thread-details-facts">
        <div className="thread-details-name">{name}</div>
        {started !== null && (
          <div className="thread-details-started">
            {startedWords(started, now)}
          </div>
        )}
        {working !== undefined && (
          <div className="thread-details-working">{working}</div>
        )}
        {behind !== null && (
          <div className="thread-details-behind">{behind}</div>
        )}
        {start !== null && (
          <button
            className="thread-details-start"
            onClick={() => onOpen(start)}
            type="button"
          >
            {START_WORDS}
          </button>
        )}
      </div>
    </section>
  )
}

/**
 * Where the column forks, leading back to it: the message it forks from;
 * or a copy's source, or a parent thread in another task, by its link,
 * which opens nothing where someone else holds it (ADR-0117, ADR-0124).
 */
function Origin({
  origin,
  onOpen,
  onLink,
}: {
  origin: HeadOrigin
  onOpen: (id: EntryId) => void
  onLink: (link: ThreadLink, at: EntryId) => void
}) {
  if (origin.kind === "none") return null
  if (origin.kind === "source")
    return (
      <button
        className="origin"
        data-copied={origin.copied || undefined}
        disabled={!opens(origin.link)}
        onClick={() => onLink(origin.link, origin.at)}
        title={
          origin.copied
            ? "show the thread it was copied from"
            : "show where it branched"
        }
        type="button"
      >
        <span className="origin-dot" />↰ {origin.words}
      </button>
    )
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
 * in your repo (ADR-0105). An
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
          title={
            review.open ? "close the review" : "review what adding it brings"
          }
          type="button"
        >
          {words.line}
        </button>
      )}
      {strip.bookmark !== null && <Bookmark name={strip.bookmark} />}
      {words.note !== null && (
        <span
          className="offer-note"
          data-acting={strip.waiting ? "sent" : "said"}
          role="status"
        >
          {words.note}
        </span>
      )}
      <span className="work-space" />
      {words.buttons.map(({ button, label, title, disabled }) => (
        <button
          className={`offer-${button}`}
          disabled={strip.waiting || disabled === true}
          key={button}
          onClick={() => act(button)}
          title={title}
          type="button"
        >
          {label}
        </button>
      ))}
      {words.menu.length > 0 && (
        <Menu
          className="offer-more"
          sections={[
            {
              key: "offer",
              items: words.menu.map(({ button, label, title, disabled }) => ({
                key: button,
                label,
                className: `offer-${button}`,
                disabled: strip.waiting || disabled === true,
                ...(title === undefined ? {} : { title }),
                onChoose: () => act(button),
              })),
            },
          ]}
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
 * How much of each ask the column draws (ADR-0106): outline, story or raw.
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
