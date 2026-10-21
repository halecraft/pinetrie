// web/column — one open path, read top to bottom, with its own scroll.

import { useSelector } from "@kyneta/react"
import {
  atEntry,
  type CanvasId,
  type ConflictChoice,
  type EntryId,
  isThreadId,
  type Position,
  ROOT,
  type Sha256,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type AccessView,
  aboutKind,
  aboutText,
  aboutTooltip,
  accessWords,
  actingSaid,
  agentsRow,
  agentsWords,
  askLine,
  buttonCommand,
  type ColumnAct,
  type ColumnHow,
  type ColumnKey,
  type ColumnMatches,
  type Column as ColumnSpec,
  type ColumnView,
  type ComposerPlacesStore,
  columnHead,
  columnProposals,
  columnView,
  composerPlace,
  conflictsView,
  crossCanvasLinks,
  type Density,
  type DigestRecord,
  earlierWords,
  effectiveBase,
  endTraces,
  entryMarginCounts,
  type FoldMemory,
  gridKeyAct,
  type HeadIdentity,
  type HeadLine,
  type HeadOrigin,
  handleTitle,
  headLane,
  type Intent,
  identityWords,
  isNextSendBranch,
  keptTraces,
  type LatestSources,
  type LiveWork,
  leftLine,
  type MediaColumnView,
  type Moments,
  marginCards,
  newPinPlace,
  noModelLine,
  noticeKey,
  noticeWords,
  opens,
  type Pending,
  type ProposalMemory,
  pinnedCardsAtEnd,
  putOnCanvasButton,
  queuedOn,
  type ReadOnly,
  type ReserveStep,
  type RowMemory,
  type SeatRecord,
  type StandingRunEnd,
  type Status,
  seenBatches,
  type ThreadLink,
  type TraceRecord,
  threadIcon,
  threadLink,
  threadReach,
  titleWords,
  traceEnd,
  traceGroups,
  traceWords,
  unstartedMode,
  type WorkFacts,
  type WorkStripButton,
  workingWords,
  yourCard,
} from "@pinetrie/interface"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import type {
  AccessActing,
  AttentionStore,
  SessionClient,
} from "@pinetrie/session"
import { newCardId } from "@pinetrie/session/connect"
import {
  type AccessAnswer,
  type AgentRun,
  type ArchivedCanvas,
  type AskIndex,
  agentCandidates,
  type CardId,
  type CardRecord,
  type CardWidth,
  entryMargin,
  isTitledCardId,
  type LaneView,
  type MediaId,
  nearestRevision,
  type ProposedThread,
  pinnedInView,
  pinTargetKey,
  pointConflicts,
  runPrompt,
  type StreamRecord,
  type TextCardId,
  type ThreadLane,
  type TreeIndex,
  threadLane,
  threadMembers,
} from "@pinetrie/threads"
import {
  behind,
  columnSpot,
  keepSpot,
  type ScreenMemory,
  type SeenEnd,
  type SpotStore,
  type ViewportStore,
} from "@pinetrie/web-core"
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Button } from "./button.tsx"
import { NewCardBox } from "./card-editor.tsx"
import { ColumnHandle, ColumnHeadStart, ColumnMenu } from "./column-menu.tsx"
import { Composer } from "./composer.tsx"
import { Dock } from "./dock.tsx"
import { Margin } from "./margin.tsx"
import { MatchList } from "./match-list.tsx"
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
import { ColumnDot } from "./root-signals.tsx"
import { isTextBox } from "./text-box.ts"
import { ThreadMark } from "./thread-mark.tsx"
import { CardTitleField } from "./title-field.tsx"
import { useAskBar } from "./use-ask-bar.ts"
import { PLACED, useFollow } from "./use-follow.ts"
import { useSeenBy } from "./use-presence.ts"
import { useStable } from "./use-stable.ts"
import { useViewport } from "./use-viewport.ts"

export interface ColumnProps {
  session: SessionClient
  /** The column as drawn: its thread, and whether it has started. */
  column: ColumnSpec
  /** The canvas it is on; null before it is known. */
  canvas: CanvasId | null
  /**
   * Which column it is: its thread's card on the canvas, which
   * folds and moves, and, its thread not yet started, closes.
   */
  columnKey: ColumnKey
  /** Its card's index on the canvas; -1 with no card. */
  position: number
  /** Its place among the columns drawn whole, as `data-position` says it. */
  drawnAt: number
  /** How many columns wide its card is drawn; 1 with no card. */
  width: CardWidth
  /** Its card's box (`ColumnContent`); false with no card. */
  ticked: boolean
  /** A canvas's label: what a fork row names a source's canvas by. */
  labelOf: (canvas: CanvasId) => string
  view: ColumnView
  index: TreeIndex
  /** This column's colour track: `--track` on the column (`useTrackColors`). */
  track: number
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<EntryId, readonly number[]>
  /** Ids any column of this tab shows: a branch leaving here that is shown needs no button. */
  shown: ReadonlySet<string>
  nameOf: ReadonlyMap<WriterId, string>
  /** Everyone who can be mentioned (`readParticipants`). */
  participants: readonly string[]
  /** Every named thread on an open canvas, whose agents a mention may reach. */
  inReach: readonly {
    readonly thread: ThreadId
    readonly name: ThreadName
  }[]
  /** The canvases in the archive: a member there is away. */
  archived: ReadonlyMap<CanvasId, ArchivedCanvas>
  /** Each person's colour (`presenceColors`). */
  colorOf: (writer: WriterId) => string
  /** This window is typing in this column, in the card its box shows. */
  onTyping: (card: CardId | null) => void
  cards: readonly CardRecord[]
  /** Each media column, as its column draws it: the pane's put names them. */
  media: ReadonlyMap<MediaId, MediaColumnView>
  /** The queued cards that are blank messages (`useBlankQueued`): they do not wait. */
  blank: ReadonlySet<CardId>
  /** Every seat the host has seen: who wrote in a card. */
  seats: readonly SeatRecord[]
  /** Every lane the agent is replying on. Several threads can run at once. */
  activity: readonly AgentRun[]
  /** The streams to draw, from the same moment as `index` (`liveWork`). */
  live: LiveWork
  lanes: readonly LaneView[]
  /** Where lanes work, the files at each entry, and each lane's proposed changes. */
  work: WorkFacts
  /** The ids on this column's path, which the app has already computed. */
  path: ReadonlySet<EntryId>
  /**
   * What a reader asks of the page. The column's own acts go as
   * `{ kind: "column", key, act }`, a message's among them.
   */
  onIntent: (intent: Intent) => void
  /** Nothing may be written here: no composer, no tools that write. */
  readOnly: ReadOnly | null
  /**
   * What each column knew of its end when last unmounted, by its key
   * (`follow.ts`).
   */
  seenEnd: ScreenMemory<SeenEnd>
  /** Each tool row's state, by its call's id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  /** Each proposal's card, as its reader left it, across unmounts. */
  proposalMemory: ScreenMemory<ProposalMemory>
  /** Each proposal's branches, from the thread records (`branchesByProposal`). */
  proposalBranches: ReadonlyMap<EntryId, readonly ProposedThread[]>
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  asks: AskIndex
  /** What the rail draws apart in this column's root, sorted: no fold hides it. */
  landmarks: readonly EntryId[]
  /** Each ask's fold, as the reader chose it, across unmounts. */
  folds: FoldMemory
  /** Each ask's model-written digest, by its prompt. */
  digests: ReadonlyMap<EntryId, DigestRecord>
  /**
   * How far you have read each thread, on every device of yours.
   */
  attention: AttentionStore
  /** Each thread's run-end report that asks something of you (`standingRunEnds`). */
  runEnds: ReadonlyMap<ThreadId, StandingRunEnd>
  /** Each thread's status (`threadStatus`): what its dot draws. */
  statuses: ReadonlyMap<ThreadId, Status>
  /** When each thread's mark last arrived, and its ✓ last showed. */
  threadArrivals: Moments<ThreadId>
  /** Every mounted column's view, which the rail outlines. */
  viewports: ViewportStore
  /** Where columns were left, by message. */
  spots: SpotStore
  /**
   * Every trace, by id: the column draws its reader's own at its
   * thread's end.
   */
  traces: ReadonlyMap<string, TraceRecord>
  /** Each column's composer, which a put on the column reads (`put-target.ts`). */
  composers: ComposerPlacesStore
  /**
   * This column's matches while a search applies, laid over its
   * thread; null while not searching.
   */
  matches: ColumnMatches | null
}

export function Column(p: ColumnProps) {
  const { index } = p
  // The path above the column's own thread, folded when the thread it forks
  // from is on no column of this canvas: unfolded, it is drawn
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

  // A move by Alt+arrows brings the column into view: it can land past the
  // strip's edge. Focus stays where it was, inside the column, through
  // React's move.
  const section = useRef<HTMLElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the column has moved
  useLayoutEffect(() => {
    const el = section.current
    if (el === null || !el.contains(document.activeElement)) return
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [p.position])

  // The spacer exists to line a new column up with its fork point. A column
  // with no fork point (the first, or one moved there) has nothing to line up
  // with, so it keeps no spacer.
  useLayoutEffect(() => {
    if (view.forkFrom === null && spacer.current !== null)
      spacer.current.style.height = "0px"
  }, [view.forkFrom])

  // A thread not yet started: its next send is a branch at its
  // anchor, its thread's first message.
  const unstarted = isNextSendBranch(p.column)
  const opening = unstartedMode(p.column)
  // A card's column moves; a started one folds, an unstarted one closes.
  const { columnKey } = p
  const card = columnKey.kind === "card" ? columnKey.card : null
  // Where a send attaches: an unstarted thread's fork, else the column's end.
  const at: Position = unstarted
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
  const act = useStable((act: ColumnAct) => {
    // A comment opens its entry's margin, where its box is drawn.
    if (act.kind === "comment") setOpenMargin(act.entry)
    p.onIntent({ kind: "column", column: p.columnKey, act })
  })

  // A linked thread opened: a fork row's, or a row from another canvas's.
  const openLink = useStable((link: ThreadLink, at: EntryId) =>
    p.onIntent({ kind: "open-link", link, entry: at }),
  )

  // Margins: the comments beside each entry, one open at a time,
  // and the entry the keys select.
  const [openMargin, setOpenMargin] = useState<EntryId | null>(null)
  const [selected, setSelected] = useState<EntryId | null>(null)
  const margins = useMemo(() => entryMarginCounts(p.cards), [p.cards])
  // The proposals this column draws, and where each stands.
  const proposals = useMemo(
    () =>
      columnProposals({
        nodes: view.nodes.map(n => n.id),
        index,
        asks: p.asks,
        branches: p.proposalBranches,
        lanes: p.lanes,
        me: p.session.writer,
      }),
    [view.nodes, index, p.asks, p.proposalBranches, p.lanes, p.session.writer],
  )
  const openComments = useMemo(() => {
    const thread =
      openMargin === null ? undefined : index.entries[openMargin]?.thread
    return openMargin === null || thread === undefined
      ? []
      : marginCards(p.cards, entryMargin(thread, openMargin))
  }, [p.cards, openMargin, index])
  const comment = useStable((entry: EntryId) => {
    const thread = index.entries[entry]?.thread
    if (thread !== undefined)
      act({ kind: "comment", card: newCardId(), entry, thread })
  })
  const typedIn = useStable((card: CardId) => p.onTyping(card))
  const marginReader = useMemo(
    () => ({ me: p.session.writer, nameOf: p.nameOf }),
    [p.session.writer, p.nameOf],
  )
  const onMargin = useStable((entry: EntryId) => setOpenMargin(entry))
  const marginSlot = useMemo(
    () =>
      openMargin === null ? null : (
        <Margin
          beside="message"
          comments={openComments}
          onAct={act}
          onComment={() => comment(openMargin)}
          onShut={() => setOpenMargin(null)}
          onTyping={typedIn}
          readOnly={p.readOnly}
          reader={marginReader}
          seats={p.seats}
          session={p.session}
        />
      ),
    [
      openMargin,
      openComments,
      act,
      comment,
      typedIn,
      p.readOnly,
      marginReader,
      p.seats,
      p.session,
    ],
  )
  // The selected entry is marked where it is drawn, again as the messages
  // are drawn anew; the selection's change alone brings it into view, so the
  // reader's own scrolling is left alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` redraws the messages the mark is on
  useLayoutEffect(() => {
    const el = content.current
    if (el === null) return
    for (const msg of el.querySelectorAll(".msg[data-selected]"))
      msg.removeAttribute("data-selected")
    if (selected === null) return
    el.querySelector(`.msg[data-entry="${selected}"]`)?.setAttribute(
      "data-selected",
      "",
    )
  }, [selected, view])
  useLayoutEffect(() => {
    if (selected === null) return
    content.current
      ?.querySelector(`.msg[data-entry="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selected])
  /**
   * The column's messages as a grid one cell wide, while focus is
   * in it and in no text box: `j` and `k` select, Enter opens the selected
   * entry's margin, Escape shuts it, and `c` comments. Cmd+C copies the
   * focused table's bar's table, else the selected entry: the page's copy
   * event reads `data-block` and `data-selected` (`clipboard.ts`).
   */
  const onEntryKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isTextBox(document.activeElement)) return
    const ids = view.nodes.map(n => n.id)
    if (ids.length === 0) return
    const at = selected === null ? -1 : ids.indexOf(selected)
    const from = at < 0 ? ids.length - 1 : at
    const entry = ids[from]
    if (entry === undefined) return
    const grid = { width: 1, rows: ids.length }
    const step = gridKeyAct(e, {
      grid,
      rows: ids.length,
      selected: from,
      hasCard: at >= 0,
      open: openMargin !== null && openMargin === entry,
      inText: false,
      comments: writable,
      trashes: false,
    })
    if (step === null) return
    e.preventDefault()
    switch (step.kind) {
      case "select":
        setSelected(ids[step.cell] ?? null)
        return
      case "open":
        setOpenMargin(openMargin === entry ? null : entry)
        return
      case "fold":
        setOpenMargin(null)
        return
      case "comment":
        comment(entry)
        return
      // A message is neither moved nor trashed.
      case "move":
      case "trash":
        return
    }
  }
  const openAt = useStable((entry: EntryId) =>
    p.onIntent({ kind: "open-at", entry }),
  )
  // What the name's `aria-controls` points at.

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
  // while you read below it.
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
      if (
        left.following &&
        p.matches === null &&
        leftLane !== null &&
        view.tipId !== null
      )
        p.attention.read(leftLane, view.tipId)
      p.attention.leave()
      p.spots.save(
        keepSpot(
          p.spots.load(),
          ids,
          columnSpot(span.current, left.following, ids.at(-1)),
        ),
      )
    },
  )
  // While they do, the column does not get shorter at its end.
  const end = useFollow(
    body,
    content,
    { floor, holding: streamingLanes.length > 0 },
    { unseen: mountedBehind, released: mountedReleased, leave },
    view.tipId,
  )
  // Watching its end, in a page you can see, you have read the thread to it:
  // a run you watch end raises nothing. Covered by a search, it
  // is not watched. `readStep` decides when the mark is written.
  const attention = p.attention
  const covered = p.matches !== null
  useEffect(() => {
    if (attention === undefined || leftLane === null || view.tipId === null)
      return
    if (end.releasedTip === null && visible && !covered)
      attention.read(leftLane, view.tipId)
  }, [attention, leftLane, view.tipId, end.releasedTip, visible, covered])
  // This thread's lane, as the host will find it: busy means a compelled
  // message waits.
  // An unstarted thread starts with its first send: it has no lane yet.
  const lane: ThreadLane = unstarted
    ? { kind: "none" }
    : threadLane(p.lanes, p.column.thread)
  const running = lane.kind === "lane" && lane.running
  // The ask this column's lane is answering.
  const runningAsk =
    lane.kind === "lane" && lane.running ? runPrompt(index, lane.tip) : null
  const density = p.column.density ?? "story"
  // When the column mounted: what the handle's title counts back from.
  const [now] = useState(() => Date.now())
  const nameFn = (w: WriterId) => nameFor(p.nameOf, w)
  const askLineOf = (ask: EntryId | null): string | null =>
    askLine(index, ask, nameFn)
  // Which ask the work at the top belongs to, while its message is out of
  // sight. Outline draws each ask's line under its message.
  const atTop = useAskBar(body, density !== "outline")
  // The cards queued for this thread's lane, above the line, in the order the
  // host pops them.
  const queued = lane.kind === "lane" ? queuedOn(p.cards, lane.name) : []
  // What you did here that was refused: an unqueue the host had popped the
  // card before, a move someone else made first, a put the
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
  // The icon drawn as the column mounts shows at once; one arriving later,
  // a new one, fades in. The composer reports `createsLane` only after the
  // mount, so the icon of the lane its next send creates counts as there
  // already.
  const [mountedIcon] = useState(
    () =>
      threadIcon({ thread: headLane(lane, true, thread), ...p.work })?.url ??
      null,
  )
  const working = workingWords(running, askLineOf(runningAsk))
  // The cards at this column's end: yours, which the composer
  // edits, and everyone else's, drawn above it. A thread's cards are found
  // by where its thread ends now; an unstarted one's by its thread.
  const threadEnd = at.kind === "entry" ? at.id : null
  const mine = unstarted
    ? yourCard(
        p.session.writer,
        { kind: "thread", thread: p.column.thread },
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
  // The thread's pinned cards, and what the agent reads of
  // them now, from the walk the host plans a run's cards from. A unstarted
  // column has no thread, so none.
  const pinned =
    unstarted || threadEnd === null
      ? []
      : pinnedCardsAtEnd(threadEnd, p.cards, index)
  const inView = threadEnd === null ? null : pinnedInView(index, threadEnd)
  // Your last command on proposed changes on this lane: in flight, refused or
  // failed.
  const acting = useSyncExternalStore(
    p.session.acting.subscribe,
    p.session.acting.current,
  )
  const origins = useMemo(
    () => ({
      canvas: p.canvas,
      linkOf: (t: ThreadId) => threadLink(t, p.cards, p.session.writer),
      labelOf: p.labelOf,
      reader: { me: p.session.writer, nameOf: p.nameOf },
    }),
    [p.canvas, p.cards, p.session.writer, p.labelOf, p.nameOf],
  )
  const shows = columnView({
    acting:
      lane.kind === "lane"
        ? (acting.proposedByLane.get(lane.name) ?? null)
        : null,
    mountedIcon,
    queued,
    index,
    asks: p.asks,
    view,
    lane,
    createsLane,
    thread,
    writable,
    nameOf: p.nameOf,
    lanes: p.lanes,
    work: p.work,
    origins,
    runEnds: p.runEnds,
  })
  // What a card's command catches up with: the thread's base,
  // or the thread it branched from. One object while what it
  // says is the same: the composer is memoised.
  const baseRecord =
    lane.kind === "lane" ? (p.work.bases.get(lane.name) ?? null) : null
  const parentLane = shows.parent?.lane ?? null
  const parentName = shows.parent?.name ?? null
  const latestSources: LatestSources = useMemo(
    () => ({
      base: effectiveBase(baseRecord),
      parent:
        parentLane === null || parentName === null
          ? null
          : { kind: "parent", lane: parentLane, name: parentName },
    }),
    [baseRecord, parentLane, parentName],
  )
  // The thread is named before its first send. The step changes
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
    thread,
    canvas: p.canvas,
    ...(opening?.root === undefined ? {} : { root: opening.root }),
    ...(pinned.length === 0 ? {} : { pinned: pinned.map(c => c.id) }),
  }
  // This thread's members and its budget, in its header.
  const agentsHere = useMemo(
    () => threadMembers(p.index, view.tipId),
    [p.index, view.tipId],
  )
  const reachable = useMemo(
    () => new Set(p.inReach.map(a => a.thread)),
    [p.inReach],
  )
  const agentsLine = useMemo(
    () =>
      agentsRow({
        thread,
        members: agentsHere,
        inReach: reachable,
        threadReach: t =>
          threadReach(t, { cards: p.cards, archived: p.archived }),
        names: p.work.names,
        nameOf: w => nameFor(p.nameOf, w),
        allowances: p.work.allowances,
      }),
    [
      thread,
      agentsHere,
      reachable,
      p.cards,
      p.archived,
      p.work.names,
      p.nameOf,
      p.work.allowances,
    ],
  )
  // Where each row from another canvas's thread is.
  const crossCanvases = useMemo(
    () =>
      crossCanvasLinks(view.nodes, {
        cards: p.cards,
        reader: { me: p.session.writer, nameOf: p.nameOf },
        here: p.canvas,
        labelOf: p.labelOf,
      }),
    [view.nodes, p.cards, p.session.writer, p.nameOf, p.canvas, p.labelOf],
  )
  // Other threads' agents a message here may name.
  const agents = useMemo(
    () => agentCandidates(p.inReach, thread, agentsHere),
    [p.inReach, thread, agentsHere],
  )
  // The column's pane: what you opened beside the thread, kept only while the
  // column is mounted. One subject at a time, named, so `paneView` can tell
  // when it is gone: the proposed changes' review after an acceptance or a
  // withdrawal, a table or an image whose message this column no longer draws.
  // The thread's next proposed changes do not open it with nobody asking.
  const [pane, setPane] = useState<PaneSubject | null>(null)
  const openPane = useStable((subject: PaneSubject) =>
    setPane(shown => togglePane(shown, subject)),
  )
  const closePane = useStable(() => setPane(null))
  // The pane's image, put in a media column made just after this thread, or
  // into one of the canvas's.
  const canvasHere = p.canvas
  const putOnCanvas = useStable((sha256: Sha256, name: string) =>
    putOnCanvasButton({
      sha256,
      name,
      canvas: canvasHere ?? ("" as CanvasId),
      thread,
      columns: p.cards.flatMap(c =>
        c.kind === "media" &&
        c.place.kind === "canvas" &&
        c.place.canvas === canvasHere
          ? [{ id: c.id, title: p.media.get(c.id)?.title ?? "" }]
          : [],
      ),
    }),
  )
  const reach = useMemo(
    () => ({ shown: pane, open: openPane }),
    [pane, openPane],
  )
  const review = shows.dock.strip?.review ?? null
  const paneShows =
    pane === null
      ? null
      : paneView(pane, {
          strip:
            review === null || shows.dock.strip === null
              ? null
              : { target: review, line: shows.dock.strip.words.line },
          nodes: view.nodes,
          askTarget: ask =>
            askReviewTarget(
              index,
              p.asks,
              p.work.revisions,
              ask,
              askLineOf(ask),
            ),
          conflicts:
            lane.kind === "lane" &&
            p.work.lanes.get(lane.name)?.history === "folder"
              ? {
                  lane: lane.name,
                  shown: conflictsView({
                    lane: lane.name,
                    conflicts: p.work.conflicts,
                    states: p.work.states,
                    laneName: l => p.work.names.get(l) ?? l,
                  }),
                }
              : null,
        })
  const chooseVersion = useStable(
    (on: ThreadId, path: string, choose: ConflictChoice) =>
      act({ kind: "resolve", lane: on, path, choose }),
  )
  const resolveSaid = actingSaid(
    lane.kind === "lane" ? acting.resolveByLane.get(lane.name) : undefined,
  )
  // Reset in render, not an effect: no frame draws a pane that is gone.
  if (pane !== null && paneShows === null) setPane(null)
  const paneId = `pane-${p.column.key}`
  const toggleReview = useStable(() => openPane({ kind: "strip" }))
  // Catching up and splitting are a card with the command and no text,
  // made in the queue: the host
  // pops it when the lane is free. An acceptance names its destination: the default,
  // or accepted work.
  const actOnProposedChanges = (button: WorkStripButton) => {
    const command = buttonCommand(button)
    if (lane.kind !== "lane") return
    if (button === "accept" || button === "accept-into-accepted") {
      const destinations = shows.dock.strip?.destinations ?? []
      const to =
        button === "accept"
          ? destinations[0]
          : destinations.find(d => d.kind === "accepted")
      if (to === undefined) return
      return act({
        kind: "proposed",
        lane: lane.name,
        action: "accept",
        to: to.bookmark,
      })
    }
    if (button === "choose-versions") return openPane({ kind: "conflicts" })
    if (
      button !== "update" &&
      button !== "continue" &&
      button !== "get-latest-from-parent" &&
      button !== "split"
    )
      return act({
        kind: "proposed",
        lane: lane.name,
        action: button,
        to: null,
      })
    if (at.kind !== "entry") return
    act({
      kind: "queue-new",
      card: newCardId(),
      hold: "keep",
      command,
      lane: lane.name,
      at,
    })
  }
  // What a lane this column's next send creates would start with.
  const above = nearestRevision(index, p.work.revisions, at)
  const forkConflicts =
    above.point === null ? [] : pointConflicts(p.work.revisions, above.point)

  const place = composerPlace(p.column, at) ?? undefined
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
  // A send from any card here: an unstarted thread's first one spends what
  // it started with.
  const onSend = () => {
    end.follow()
    if (unstarted) p.onIntent({ kind: "sent-first", card: p.column.thread })
    return undefined
  }
  // Where a queue from a card's ⋯ puts it: on this thread's lane, at its end.
  const queueOn =
    lane.kind === "lane" && at.kind === "entry" ? { lane: lane.name, at } : null
  // Where a drop lands: exactly where a put can.
  const putColumn = writable && place !== undefined ? key : null
  const pinKey = writable && place !== undefined ? pinTargetKey(place) : null
  const putPinned = pinKey === null ? null : key
  // "+ pin" opens a box that makes a pinned card. While it is
  // open, the strip leaves out the card it shows, as the column leaves out
  // the composer's. It closes when focus leaves it.
  const [pinning, setPinning] = useState(false)
  const [retitling, setRetitling] = useState(false)
  const [pinShown, setPinShown] = useState<TextCardId | null>(null)
  const newPin = newPinPlace({
    canPin: pinKey !== null && !unstarted && threadEnd !== null,
    pinning,
    pinned: pinned.length,
  })
  const openPin = () => setPinning(true)
  /** Read the column at `d`: the reader's own move, so at the end it stays there, and no floor holds the change (`follow.ts`). */
  const chooseDensity = (d: Density) => {
    act({ kind: "density", density: d })
    body.current?.dispatchEvent(new Event(PLACED))
  }
  const head =
    card === null
      ? null
      : columnHead({
          card,
          width: p.width,
          writable,
          unstarted,
          folded: false,
          ticked: p.ticked,
          density: view.nodes.length > 0 ? density : null,
          start: shows.head.facts?.start ?? null,
          pin: newPin === "menu",
        })
  // Your traces where your cards were at this thread's end, when someone
  // else moved them while you were away. Drawn in a page you can
  // see, a trace is seen: the host deletes it, and this column keeps drawing
  // what it drew until it unmounts (`keptTraces`). Not in a column that
  // cannot be written: an archived root's is a glance, not a return.
  const watches = writable && threadEnd !== null
  const traces =
    !watches || threadEnd === null
      ? []
      : endTraces(p.traces.values(), p.session.writer, threadEnd, from =>
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
  const branchInstead = (pending: Pending) => {
    if (at.kind === "entry") act({ kind: "branch-instead", at: at.id, pending })
  }

  return (
    <section
      className="column"
      ref={section}
      data-card={card ?? undefined}
      data-kind="thread"
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
              {head !== null && (
                <ColumnHeadStart head={head} onIntent={p.onIntent} />
              )}
              <HeadHandle
                card={card}
                identity={shows.head.identity}
                running={running}
                title={handleTitle(
                  shows.head.facts,
                  shows.head.base,
                  agentsLine === null ? null : agentsWords(agentsLine),
                  now,
                )}
                working={working}
              />
              {head !== null && card !== null && isThreadId(card) && (
                <ColumnDot
                  arrived={p.threadArrivals.arrived.get(card) ?? null}
                  done={p.threadArrivals.done.get(card) ?? null}
                  nameOf={p.nameOf}
                  status={p.statuses.get(card) ?? null}
                  worded
                />
              )}
              <span className="head-space" />
              {p.matches !== null && (
                <span className="match-count">{p.matches.count}</span>
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
              {head !== null && (
                <ColumnMenu
                  onDensity={chooseDensity}
                  onIntent={p.onIntent}
                  onPin={openPin}
                  onRename={() => setRetitling(true)}
                  sections={head.menu}
                />
              )}
            </div>
            {/* Under the line, always: why it needs you, else what it is
            doing; where it came from; and an ssh ask, for its owner. */}
            {retitling && writable && card !== null && isTitledCardId(card) ? (
              <CardTitleField
                card={card}
                onEnd={() => setRetitling(false)}
                onIntent={p.onIntent}
                placeholder={
                  shows.head.line.kind === "about"
                    ? aboutText(shows.head.line.about)
                    : titleWords(card).field
                }
                stored={p.work.titles.get(card)?.title ?? null}
              />
            ) : (
              <HeadLineView
                line={shows.head.line}
                nameOf={p.nameOf}
                onOpen={openAt}
              />
            )}
            <Origin
              onLink={openLink}
              onOpen={openAt}
              origin={shows.head.origin}
            />
            {shows.head.access !== null && lane.kind === "lane" && (
              <AccessRowView
                acting={acting.access.get(lane.name) ?? null}
                answer={answer =>
                  void p.session.access(lane.name, answer).catch(() => {})
                }
                view={shows.head.access}
              />
            )}
            {view.above.length > 0 && (
              <Button
                look="plain"
                className="earlier"
                onClick={() => setAboveOpen(true)}
                title="show the path above this thread"
              >
                {earlierWords(view.above.length)}
              </Button>
            )}
          </header>
          {/* Under a search, the thread stays as it is, covered and inert,
          with its matches laid over it: leaving needs no
          restoring. Positioned, this is the messages' offsetParent, and the
          body's, so their offsets from the body hold. */}
          <div className="column-below">
            <div className="column-under" inert={p.matches !== null}>
              {!unstarted && threadEnd !== null && (
                <PinnedStrip
                  box={
                    pinning && pinKey !== null ? (
                      <NewCardBox
                        among={pinned}
                        focusOnMount
                        onAct={act}
                        onLeave={() => setPinning(false)}
                        onShows={setPinShown}
                        onTyping={p.onTyping}
                        reader={reader}
                        session={p.session}
                        to={pinKey}
                      />
                    ) : null
                  }
                  cards={pinned.filter(c => c.id !== pinShown)}
                  latestSources={latestSources}
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
                    <Button
                      look="plain"
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
                    >
                      {atTop.kind === "elsewhere" && "↰ answering "}
                      {askLineOf(atTop.ask)}
                    </Button>
                  </div>
                )}
                {/* `useFollow` watches its height. Keep it unpositioned: it would
            become the messages' offsetParent, and `alignOnOpen` measures
            their offsetTop against the body's. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: the column's entry keys (`onEntryKey`); each message's tools are buttons */}
                <div
                  className="column-content"
                  onClick={e => {
                    const msg =
                      e.target instanceof Element
                        ? e.target.closest<HTMLElement>(".msg[data-entry]")
                        : null
                    // The drawn entry, branded as the view holds it.
                    const entry = view.nodes.find(
                      n => n.id === msg?.dataset.entry,
                    )?.id
                    if (entry !== undefined) setSelected(entry)
                  }}
                  onKeyDown={onEntryKey}
                  ref={content}
                  tabIndex={-1}
                >
                  {/* Room above the first message, so opening can bring it level with
            its fork point even when the column is short. */}
                  <div className="spacer" ref={spacer} />
                  <MessageList
                    forks={p.forks}
                    index={index}
                    joins={shows.joins}
                    crossCanvasLinks={crossCanvases}
                    onLink={openLink}
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
                    margins={margins}
                    marginSlot={marginSlot}
                    onMargin={onMargin}
                    openMargin={openMargin}
                    proposals={proposals}
                    proposalMemory={p.proposalMemory}
                    readOnly={p.readOnly?.label ?? null}
                    onColumnAct={act}
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
                        <Reply
                          doc={p.session.live}
                          key={reply.id}
                          stream={reply}
                        />
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
                    <Button
                      look="outline"
                      className="jump-latest"
                      onClick={end.follow}
                    >
                      ↓ new below
                    </Button>
                  </div>
                )}
              </div>
              {traceRows.length > 0 && (
                <div className="traces">
                  {traceRows.map(g => {
                    const last = g.traces.at(-1)
                    return (
                      last !== undefined && (
                        <Button
                          look="plain"
                          className="trace"
                          data-trace={g.traces.map(t => t.id).join(" ")}
                          key={last.id}
                          onClick={() =>
                            p.onIntent({ kind: "open-trace", trace: last })
                          }
                          title="show where it is now"
                        >
                          {traceWords(g, reader)}
                        </Button>
                      )
                    )
                  })}
                </div>
              )}
              <Dock
                strip={shows.dock.strip}
                stripShown={shows.dock.shown}
                onStrip={actOnProposedChanges}
                review={{
                  id: paneId,
                  open: pane?.kind === "strip",
                  toggle: toggleReview,
                }}
                asks={p.asks}
                blank={p.blank}
                cards={p.cards}
                latestSources={latestSources}
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
                  noModel={noModelLine(p.work.setup)}
                  at={at}
                  how={how}
                  unstarted={unstarted}
                  reader={{ me: p.session.writer, nameOf: p.nameOf }}
                  prefill={opening?.prefill}
                  lane={lane}
                  onBranchInstead={branchInstead}
                  onSend={onSend}
                  onAct={act}
                  onCreatesLane={setCreatesLane}
                  onIntent={p.onIntent}
                  onTyping={p.onTyping}
                  latestSources={latestSources}
                  resolve={shows.dock.resolve}
                  putColumn={putColumn}
                  participants={p.participants}
                  agents={agents}
                  pending={opening?.pending}
                  readOnly={p.readOnly}
                  typingAt={view.tipId}
                  session={p.session}
                />
              </Dock>
            </div>
            {p.matches !== null && (
              <MatchList matches={p.matches} onOpen={openAt} />
            )}
          </div>
        </div>
        {pane !== null && paneShows !== null && (
          <Pane
            choose={chooseVersion}
            close={closePane}
            onIntent={p.onIntent}
            putOnCanvas={
              p.readOnly === null && p.canvas !== null ? putOnCanvas : null
            }
            id={paneId}
            said={resolveSaid}
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
 * The column's handle: who works in it (its lane's name, a lane about to
 * start, or "chat") with its mark, the one part of the header a drag starts
 * from (`ColumnHandle`). Its mark pulses while the lane runs.
 */
function HeadHandle({
  card,
  identity,
  running,
  title,
  working,
}: {
  card: CardId | null
  identity: HeadIdentity
  running: boolean
  /** Who started the thread and when, its base and the agents line (`handleTitle`). */
  title: string | null
  working: string | undefined
}) {
  const inner = (
    <>
      {identity.kind !== "none" && (
        <>
          <ThreadMark
            folds
            icon={identity.kind === "agent" ? identity.icon : null}
            running={running}
            working={working}
          />{" "}
        </>
      )}
      <span data-fold-name="">{identityWords(identity)}</span>
    </>
  )
  const className =
    identity.kind === "none"
      ? "head-chat"
      : `agent-name${identity.kind === "pending" ? " pending" : ""}`
  return (
    <ColumnHandle
      card={card}
      className={className}
      thread={identity.kind === "agent" ? identity.name : undefined}
      {...(title === null ? {} : { title })}
    >
      {inner}
    </ColumnHandle>
  )
}

/**
 * Under a column's line, always (`headLine`): the reason of a run-end status
 * raised for you, alone, in its level's colour, its title the level then the
 * reason, a press bringing the run's last entry into view; else what the
 * thread is about, its opening line dimmed; else nothing.
 */
function HeadLineView({
  line,
  nameOf,
  onOpen,
}: {
  line: HeadLine
  nameOf: ReadonlyMap<WriterId, string>
  onOpen: (id: EntryId) => void
}) {
  switch (line.kind) {
    case "none":
      return null
    case "status": {
      const { status } = line
      return (
        <Button
          look="plain"
          className="head-status"
          data-level={status.level}
          data-role="reason"
          onClick={() => onOpen(status.end)}
          title={status.words}
        >
          {status.reason}
        </Button>
      )
    }
    case "about": {
      const { about } = line
      return (
        <div
          className="head-focus"
          data-kind={aboutKind(about)}
          data-role="focus"
          title={aboutTooltip(about, nameOf)}
        >
          {aboutText(about)}
        </div>
      )
    }
  }
}

/**
 * Where the column forks, leading back to it: the message it forks from;
 * or a copy's source, or a parent thread in another canvas, by its link,
 * which opens nothing where someone else holds it.
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
      <Button
        look="plain"
        className="origin"
        data-role="origin"
        data-copied={origin.copied || undefined}
        disabled={!opens(origin.link)}
        onClick={() => onLink(origin.link, origin.at)}
        title={
          origin.copied
            ? "show the thread it was copied from"
            : "show where it branched"
        }
      >
        <span className="origin-dot" />↰ {origin.words}
      </Button>
    )
  return (
    <Button
      look="plain"
      className="origin"
      data-role="origin"
      onClick={() => onOpen(origin.at)}
      title="show where this branch starts"
    >
      <span className="origin-dot" />↰ {origin.speaker}: “{origin.text}”
    </Button>
  )
}

/**
 * A lane's ssh identities: what it holds and has used, and for the owner the
 * answers its state takes, which wait while one is out.
 */
function AccessRowView({
  view,
  acting,
  answer,
}: {
  view: AccessView
  acting: AccessActing | null
  answer: (answer: AccessAnswer) => void
}) {
  const words = accessWords(view, acting)
  return (
    <div
      className="work access"
      data-state={view.personal?.kind ?? "service"}
      role="status"
    >
      <span className="access-line">{words.line}</span>
      {words.note !== null && <span className="access-note">{words.note}</span>}
      <span className="work-space" />
      {words.answers.map(({ answer: a, label }) => (
        <Button
          look="outline"
          className={`access-${a}`}
          disabled={words.waiting}
          key={a}
          onClick={() => answer(a)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
