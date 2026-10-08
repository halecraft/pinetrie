// web/column — one open path, read top to bottom, with its own scroll.

import { useSelector } from "@kyneta/react"
import {
  type AgentRun,
  type AskIndex,
  atEntry,
  type CardId,
  type CardRecord,
  conflictsAt,
  type DigestRecord,
  type EntryId,
  type LaneName,
  type LaneView,
  messageAt,
  nearestRevision,
  type Position,
  pinnedInView,
  pinnedOf,
  promptOf,
  ROOT,
  type SeatRecord,
  type StopRecord,
  type StreamRecord,
  type ThreadLane,
  type TraceRecord,
  type TreeIndex,
  threadOf,
  type WriterId,
  workFor,
} from "@pinetrie/core"
import {
  AGENT_MARK,
  askWords,
  bannerUrl,
  behind,
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  type Column as ColumnSpec,
  type ColumnView,
  type ComposerPlacesStore,
  closeAskWords,
  columnView,
  composerPlace,
  DENSITIES,
  type Density,
  DISCARD,
  densityWords,
  detailsTitle,
  dropProps,
  type EditorState,
  type FoldMemory,
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
  NEW_PIN,
  NEW_PIN_TITLE,
  newPinAt,
  noticeKey,
  noticeWords,
  type Pending,
  type QueueControls,
  queueControlWords,
  type Reader,
  type ReadOnly,
  type ReserveStep,
  type RowMemory,
  type RunButton,
  runWords,
  type ScreenMemory,
  type SeenEnd,
  type SpotStore,
  START_WORDS,
  seenBatches,
  shownBelow,
  shownBy,
  spotOf,
  startedWords,
  type ThreadDetails,
  traceGroups,
  tracesAt,
  traceWords,
  type ViewportStore,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "@pinetrie/interface"
import {
  cardsAt,
  effectiveBase,
  factLine,
  type OfferButton,
  placeEnd,
  queuedOn,
  yourCard,
} from "@pinetrie/rules"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import type { AttentionStore } from "@pinetrie/session"
import {
  drawnPlace,
  newCardId,
  newLaneName,
  type SessionClient,
} from "@pinetrie/session"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { CardEditor, QueuedCardEditor } from "./card-editor.tsx"
import { Composer } from "./composer.tsx"
import { COPIED, useCopy } from "./copy.ts"
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
  position: number
  /** How many columns the strip holds: with two or more, a column can move. */
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
  /** Who stopped each ask, by its prompt (ADR-0106). */
  stops: ReadonlyMap<EntryId, StopRecord>
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
  /** Each column's composer place, which a put lands in (`put-target.ts`). */
  composers: ComposerPlacesStore
}

export function Column(p: ColumnProps) {
  const { view, index } = p
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

  const fresh = p.column.fresh !== undefined
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
    p.onIntent({
      kind: "column",
      position: p.position,
      key: p.column.key,
      act,
    }),
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
  const leftLane = p.column.lane ?? null
  const readLeft = useStable(() =>
    leftLane === null
      ? undefined
      : p.attention.attention.current().read.get(leftLane),
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
  const thread = threadOf(p.index, p.lanes, {
    at,
    mode: fresh ? "branch" : "reply",
    lane: p.column.lane ?? null,
    me: p.session.writer,
  })
  const lane: ThreadLane =
    thread.kind === "thread" ? thread.lane : { kind: "none" }
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
  const reserved = p.column.reserved ?? null
  // The banner drawn as the column mounts shows at once; one arriving later,
  // a new one, fades in. The composer reports `createsLane` only after the
  // mount, so a reserved lane's banner counts as there already.
  const [mountedBanner] = useState(() =>
    bannerUrl(headLane(lane, true, reserved), p.work.banners),
  )
  // Whether the reader opened the thread's details here, since the column
  // mounted: they spin only then, and not when a reload or a tab switch
  // mounts them open (ADR-0073), as a banner there at mount does not fade.
  const [openedHere, setOpenedHere] = useState(false)
  const working = workingWords(running, askLine(runningAsk))
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
  // The thread's pinned cards (ADR-0048 step 5), and what the agent reads of
  // them now, from the walk the host plans a run's cards from. A fresh
  // column has no thread, so none.
  const pinned =
    fresh || threadEnd === null
      ? []
      : cardsAt("pinned", threadEnd, p.cards, p.lanes, index)
  const inView = threadEnd === null ? null : pinnedInView(index, threadEnd)
  // Your last offer command on this lane: in flight, refused or failed.
  const acting = useSyncExternalStore(
    p.session.acting.subscribe,
    p.session.acting.current,
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
    reserved,
    writable,
    nameOf: p.nameOf,
    lanes: p.lanes,
    work: p.work,
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
    if (step.kind === "mint")
      act({ kind: "reserve", key: p.column.key, lane: newLaneName() })
    else if (step.kind === "ask")
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
    ...(p.column.lane === undefined ? {} : { lane: p.column.lane }),
    ...(reserved === null ? {} : { reserved }),
    ...(p.column.fresh?.root === undefined
      ? {}
      : { root: p.column.fresh.root }),
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
  // queued at once (ADR-0108, ADR-0061, ADR-0080): the host pops it when
  // the lane is free. An acceptance names its destination: the default,
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
    const root = p.session.rootOf(at.id)
    if (root === undefined) return
    act({
      kind: "queueCommand",
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
      create: {
        id: newCardId(),
        owner: p.session.writer,
        place: { kind: "drafting", root, at, lane: lane.name },
        placer: p.session.writer,
        carries: { kind: "message", command: null },
        unsent: null,
      },
    })
  }
  // Where a lane this column's next send creates would work, before a choice,
  // and what its copy would start with.
  const above = nearestRevision(index, p.work.revisions, at)
  const defaultWork = workFor({
    choice: null,
    above: above.lane,
    lanes: p.work.lanes,
    project: p.work.project,
  })
  const forkConflicts =
    above.commit === null ? [] : conflictsAt(p.work.revisions, above.commit)

  // Every card here but the one the composer shows (`shownBelow`):
  // everyone else's, and any other of yours, such as one someone unqueued
  // while you typed this one, one put here while you had one, or the one
  // "+ card" set aside. A fresh column's are those under its key.
  const [composer, setComposer] = useState<EditorState | undefined>(undefined)
  const shown = shownBelow(composer, mine?.id)
  const others = (
    fresh
      ? p.cards.filter(
          c => c.place.kind === "fresh" && c.place.column === p.column.key,
        )
      : threadEnd === null
        ? []
        : cardsAt("drafting", threadEnd, p.cards, p.lanes, index)
  ).filter(c => c.id !== shown)
  const place =
    composerPlace(
      p.column,
      at,
      at.kind === "entry" ? p.session.rootOf(at.id) : undefined,
    ) ?? undefined
  // A put lands where this composer would create a card. A column that can
  // be written publishes it; one leaving takes it back.
  const { composers } = p
  const key = p.column.key
  useEffect(() => {
    composers.set(key, writable ? (place ?? null) : null)
  })
  useEffect(() => () => composers.set(key, null), [composers, key])
  // A send from any card here: a fresh column's first one names the message
  // the column then follows.
  const onSend = () => {
    end.follow()
    if (!fresh) return undefined
    const sendId = crypto.randomUUID()
    act({ kind: "sent", key: p.column.key, sendId })
    return sendId
  }
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
      : tracesAt(
          p.traces.values(),
          p.session.writer,
          threadEnd,
          (from, placer) =>
            from.kind === "drafting" ||
            from.kind === "queued" ||
            from.kind === "pinned"
              ? placeEnd(from, placer, p.lanes, index)
              : null,
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
      ? [...(mine === undefined ? [] : [mine]), ...others]
          .filter(c => p.session.cardText(c.id).text().trim() !== "")
          .map(c => c.id)
      : []
    if (typed.length > 0) setAskClose(typed)
    else act({ kind: "close", discard: [] })
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
      data-pane={pane?.kind}
      data-track={p.track}
      style={colors.style(p.track)}
    >
      <PaneReach value={reach}>
        <div className="column-thread">
          <header className="column-head" data-color={colors.slot(p.track)}>
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
            {askClose !== null && (
              <div className="close-ask">
                {closeAskWords(askClose.length)}{" "}
                <button
                  // biome-ignore lint/a11y/noAutofocus: the default answer to the ask just shown
                  autoFocus
                  className="close-keep"
                  onClick={() => {
                    setAskClose(null)
                    act({ kind: "keep", cards: askClose })
                  }}
                  type="button"
                >
                  {KEEP_IN_INVENTORY}
                </button>{" "}
                <button
                  className="close-discard"
                  onClick={() => {
                    setAskClose(null)
                    act({ kind: "close", discard: askClose })
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
                    place={drawnPlace(pinKey, p.session.writer)}
                    prefill={undefined}
                    readOnly={p.readOnly}
                    reader={reader}
                    seats={p.seats}
                    session={p.session}
                    takeFocus={() => true}
                    where={undefined}
                  />
                ) : null
              }
              cards={pinned.filter(c => c.id !== pinShown)}
              inView={inView}
              onNewPin={newPin === "strip" ? openPin : null}
              onAct={act}
              onTyping={p.onTyping}
              putKey={putPinned}
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
                stops={p.stops}
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
              {/* Cards queued for this thread's lane, in the order the host pops
            them: not in the tree yet, and editable by anyone until popped. */}
              {queued.map((c, n) =>
                c.carries.kind === "fact" ? (
                  // The host's fact, waiting for the run's end: nobody edits
                  // or moves it (ADR-0080).
                  <div className="queued-fact" key={c.id}>
                    {factLine(c.carries.fact)}
                  </div>
                ) : (
                  <QueuedCardEditor
                    among={queued}
                    card={c}
                    key={c.id}
                    n={n}
                    onAct={act}
                    onTyping={p.onTyping}
                    readOnly={p.readOnly}
                    reader={reader}
                    session={p.session}
                    catchUps={catchUps}
                  />
                ),
              )}
              {refused.map(r => (
                <div className="refused-move" key={noticeKey(r)}>
                  {noticeWords(r, reader)}
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
          {/* Everyone else's cards at this end (ADR-0048): shown in full, each
          editable and sendable by anyone here. */}
          {others.length > 0 && (
            <div
              className="cards"
              {...(putColumn === null
                ? {}
                : dropProps({ kind: "column", key: putColumn }))}
            >
              {others.map(c => (
                <CardEditor
                  at={at}
                  card={c}
                  commands={p.work.commands}
                  fresh={fresh}
                  how={how}
                  key={c.id}
                  lane={lane}
                  onAct={act}
                  onBranchInstead={branchInstead}
                  onCreatesLane={undefined}
                  onShows={undefined}
                  onIntent={p.onIntent}
                  onSend={onSend}
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
                  onLeave={undefined}
                  catchUps={catchUps}
                  where={undefined}
                />
              ))}
            </div>
          )}
          <WorkStripView
            act={actOnOffer}
            review={{
              id: paneId,
              open: pane?.kind === "offer",
              toggle: toggleReview,
            }}
            strip={shows.strip}
          />
          {shows.run !== null && lane.kind === "lane" && (
            <RunButtonView
              lane={lane.name}
              run={shows.run}
              session={p.session}
            />
          )}
          {shows.queue !== null && (
            <QueueControlsView
              controls={shows.queue}
              onAct={act}
              reader={reader}
            />
          )}
          <Composer
            card={mine}
            place={place}
            seats={p.seats}
            where={{
              defaultWork,
              project: p.work.project,
              accepted: p.work.accepted,
              forkConflicts: forkConflicts.length,
              usedDirs: [
                ...new Set(
                  [...p.work.lanes.values()].flatMap(r =>
                    r.work?.kind === "direct" ? [r.work.dir] : [],
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
            onSend={onSend}
            onAct={act}
            onCreatesLane={setCreatesLane}
            onShows={setComposer}
            onIntent={p.onIntent}
            onTyping={p.onTyping}
            takeFocus={() => p.takeFocus(p.column.key)}
            catchUps={catchUps}
            putColumn={putColumn}
            participants={p.participants}
            pending={p.column.fresh?.pending}
            readOnly={p.readOnly}
            typingAt={view.tipId}
            session={p.session}
          />
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
/**
 * Stop or Resume (`RunButton`): the column's, not a card's. Each is a
 * request on the thread's lane; the host decides it again.
 */
function RunButtonView(p: {
  run: RunButton
  lane: LaneName
  session: SessionClient
}) {
  const words = runWords(p.run)
  return (
    <button
      className={words.className}
      onClick={() => void p.session.request({ kind: p.run.kind, lane: p.lane })}
      title={words.title}
      type="button"
    >
      {words.label}
    </button>
  )
}

/**
 * A thread's queue controls (ADR-0048 step 7): hold it or release it, and
 * unqueue all. Each is a column act; the host decides it again.
 */
function QueueControlsView(p: {
  controls: QueueControls
  reader: Reader
  onAct: (act: ColumnAct) => void
}) {
  const { lane, heldBy } = p.controls
  const words = queueControlWords(p.controls, p.reader)
  const { unqueueAll } = words
  return (
    <div className="queue-controls" data-held={heldBy ?? undefined}>
      {words.held !== null && <span className="queue-held">{words.held}</span>}
      <button
        className={words.hold.className}
        onClick={() =>
          p.onAct({ kind: "holdQueue", lane, held: heldBy === null })
        }
        title={words.hold.title}
        type="button"
      >
        {words.hold.label}
      </button>
      {unqueueAll !== null && (
        <button
          className={unqueueAll.className}
          onClick={() => p.onAct({ kind: "unqueueAll", lane })}
          title={unqueueAll.title}
          type="button"
        >
          {unqueueAll.label}
        </button>
      )}
    </div>
  )
}

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
 * magnified, its name, who started it and where it works, what it works on
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
  const { started, where, behind, start } = details
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
        {where !== null && <div className="thread-details-where">{where}</div>}
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

/** Where the column forks, leading back to it. */
function Origin({
  origin,
  onOpen,
}: {
  origin: HeadOrigin
  onOpen: (id: EntryId) => void
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
 * in your repo (ADR-0105), or where a lane that works directly writes. An
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
