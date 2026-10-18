// web/app — the page: `App`, which `main.tsx` mounts.
//
// The screen is the sidebar down the left, the root you are on beside it, a
// rail beside a strip of columns, and the footer along the bottom: you, the
// board's strip, what needs you and publish (docs/06-interface.md).
// The rail draws the root's tree; each column is one path, read on
// its own scroll; the board opens over them, and a search's bar above them.
// What is drawn is a read of the
// document, through `@pinetrie/reads` and `projection.ts`. The sidebar is your
// own document, on every device (`openThreads`). Which root you are on, each
// root's columns and whether the board is open are this window's own view
// state: a reducer (`layout.ts`), kept in this browser tab's storage and
// never in the document. A search is view state too, never kept.
//
// `App` gathers, `appView` (`app-view.ts`) decides what is shown, and a click
// comes back as an `Intent`, which `planIntent` (`intent.ts`) plans and
// `perform` carries out.
//
// The renderer before React rebuilt the transcript with `innerHTML` on every
// change, which destroyed focus and selection on every keystroke. React gives
// stable node identity, which `useText` needs to keep a card's textarea
// bound while everyone types.

import { whenSettled } from "@kyneta/exchange"
import { useDocStatus, useSelector } from "@kyneta/react"
import {
  type ArchivedCanvas,
  branchesByProposal,
  type CanvasId,
  type CardId,
  canvasPinnedInView,
  type EntryId,
  entryThread,
  isPastAddress,
  parseAddress,
  pathIds,
  type TextCard,
  type ThreadId,
  type WorkflowState,
  type WorkflowStateId,
} from "@pinetrie/core"
import {
  type AppPorts,
  appView,
  boardView,
  branchColors,
  type Clip,
  type Column as ColumnSpec,
  canvasColumnView,
  canvasesOnBoard,
  canvasIcons,
  canvasNoteColumns,
  canvasRail,
  canvasStrip,
  canvasTrash,
  canvasWork,
  claimFocus,
  clipboardCellView,
  clipFacts,
  columnForeign,
  columnLandmarks,
  columnMatches,
  composerPlacesStore,
  type Dock,
  directoryRootEntries,
  type Effect,
  type Focus,
  type FocusKey,
  foldMemory,
  type HeldView,
  heldByOthers,
  historyView,
  type Identity,
  type Intent,
  type IntentState,
  inboxCount,
  inboxMentions,
  initialLayout,
  inventoryThreads,
  keyAct,
  type Layout,
  type ListWidth,
  laneRootEntries,
  layoutReducer,
  messageCount,
  NO_TEXT,
  nameEffects,
  openColumns,
  openProposedByCanvas,
  ownCards,
  type ProposalMemory,
  pageTitle,
  parseQuery,
  parseSearch,
  perform,
  placement,
  planHeldRoots,
  planIntent,
  planReading,
  projectColumns,
  type RootDrag,
  type RowMemory,
  railStubWords,
  readHeldLanes,
  readSessionFacts,
  reconcileName,
  resolveLayout,
  restoreStatus,
  rootSeed,
  type SearchState,
  type SeenEnd,
  type Spot,
  type Strip as StripView,
  screenMemory,
  searchCorpus,
  searchLine,
  searchOn,
  searchReducer,
  searchTexts,
  setupView,
  shownWidth,
  sidebarView,
  spotFor,
  spotScrollTop,
  spotStore,
  storedLayout,
  stripCards,
  type ThreadLink,
  type TypedLast,
  taskLabels,
  taskSummaries,
  threadAnchor,
  threadCardHeads,
  threadFace,
  threadIcon,
  threadLink,
  threadPreview,
  threadTrack,
  threadWork,
  trackIndex,
  typingDue,
  unsentSignals,
  unstartedMode,
  uploadBlob,
  viewportStore,
} from "@pinetrie/interface"
import {
  participantsIn,
  readHeldIndex,
  readParticipantNames,
  readParticipantPictures,
  readRoots,
} from "@pinetrie/reads"
import {
  type CardOnCanvas,
  canvasLines,
  canvasList,
  canvasPinnedCards,
  displayName,
  reachableAgents,
  TRASH_KEEP_MS,
  taskBoard,
  tasksInArchive,
  unstartedThreads,
} from "@pinetrie/rules"
import {
  heldBy,
  newCanvasId,
  newCardId,
  newNoteColumnId,
  newReferenceCardId,
  newRootId,
  newThreadId,
  type SessionClient,
  settleSlots,
  slotIntents,
} from "@pinetrie/session"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Board, BoardStrip } from "./board.tsx"
import { CardHistories } from "./card-history.tsx"
import { useClipboard } from "./clipboard.ts"
import { useFileDropGuard } from "./file-drop.ts"
import { type FocusContext, focusFacts } from "./focus.ts"
import { FocusClaim } from "./focus-claim.ts"
import { Footer } from "./footer.tsx"
import { HistoryPage } from "./history-page.tsx"
import { threadRow } from "./inbox-menu.tsx"
import { InventoryPanel } from "./inventory-panel.tsx"
import { Page } from "./page.tsx"
import { TrackSeed } from "./palette-context.ts"
import { Pictures } from "./pictures-context.ts"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { ProfilePage } from "./profile-page.tsx"
import { EmptyRail, LiveRail } from "./rail.tsx"
import { fetchedQuote } from "./renderings.tsx"
import {
  NO_PREFS,
  type ReviewPrefs,
  ReviewPrefsContext,
} from "./review-prefs.ts"
import { SearchBar, SearchToggle } from "./search-bar.tsx"
import { SetupPage } from "./setup-page.tsx"
import { Sidebar } from "./sidebar.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { Strip } from "./strip.tsx"
import type { DeviceState, TabState } from "./tab-state.ts"
import { ThreadStates } from "./thread-states.ts"
import { useAttention } from "./use-attention.ts"
import { useBlankQueued } from "./use-blank-queued.ts"
import { useDrag } from "./use-drag.ts"
import { useFilledCards } from "./use-filled-cards.ts"
import { FLIGHT_MS, useFlight } from "./use-flight.ts"
import { useFoldMotion } from "./use-fold-motion.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { NarrowContext, useStripNarrow } from "./use-narrow.ts"
import { showPage, usePage } from "./use-page.ts"
import { useLanding, useReveal, useRevealCard } from "./use-reveal.ts"
import { useSameData } from "./use-same-data.ts"
import { useSmallWindow } from "./use-small-window.ts"
import { useStable } from "./use-stable.ts"

/** What `App` keeps on this device and tab, built by `main.tsx`. */
export interface AppStores {
  readonly layout: TabState<Layout>
  readonly identity: DeviceState<Identity>
  /** Where the inventory panel is docked, on this device. */
  readonly dock: DeviceState<Dock>
  /** How you read a review, on this device. */
  readonly review: DeviceState<ReviewPrefs>
  /** The sidebar full or folded to icons, chosen in this tab. */
  readonly list: TabState<ListWidth>
}

/**
 * Where search stands for the keys (`Focus.search`): focused in the bar,
 * a match list, or nowhere, which Escape closes from.
 */
function searchFocus(
  el: Element | null,
  searchable: boolean,
  open: boolean,
): Focus["search"] {
  if (!searchable) return "unavailable"
  if (!open) return "closed"
  return el === null ||
    el === document.body ||
    el.closest(".search-bar, .match-list") !== null
    ? "focused"
    : "open"
}

/**
 * Bring a newly opened column's first message level with its fork point in
 * the column that shows it (`placement`, `align.ts`). A column with no fork
 * point, or with one below the view of the column showing it, opens at its
 * end. Then tell the column it was placed, so it follows its end only if it
 * was placed there (`follow.ts`).
 */
function alignOnOpen(strip: HTMLElement, key: string, forkFrom: string | null) {
  const column = strip.querySelector<HTMLElement>(`.column[data-key="${key}"]`)
  const body = column?.querySelector<HTMLElement>(".column-body")
  if (
    column === null ||
    column === undefined ||
    body === null ||
    body === undefined
  )
    return
  place(strip, column, body, forkFrom)
  settle(body)
}

/**
 * Tell a column it was placed, so it follows its end only if it was placed
 * there (`follow.ts`). Every placement on mounting ends with it.
 */
const settle = (body: HTMLElement) => body.dispatchEvent(new Event(PLACED))

/**
 * Bring a column shown again back to where it was left (`spotScrollTop`,
 * `viewport.ts`), then tell it it was placed. False when its spot's message
 * is not drawn, or its content fits its view: alignment places it then.
 */
function placeOnReturn(
  strip: HTMLElement,
  key: string,
  spot: Spot,
  lastId: string | undefined,
): boolean {
  const body = strip.querySelector<HTMLElement>(
    `.column[data-key="${key}"] .column-body`,
  )
  const message = body?.querySelector<HTMLElement>(
    `.msg[data-entry="${spot.id}"]`,
  )
  if (body === null || body === undefined) return false
  if (message === null || message === undefined) return false
  const at = message.getBoundingClientRect()
  const top = at.top - body.getBoundingClientRect().top + body.scrollTop
  const to = spotScrollTop(spot, {
    top,
    bottom: top + at.height,
    scrollHeight: body.scrollHeight,
    clientHeight: body.clientHeight,
    lastId,
  })
  if (to === null) return false
  body.scrollTop = to
  settle(body)
  return true
}

/** Measure the column and its fork point, then scroll it or grow its spacer as `placement` says. */
function place(
  strip: HTMLElement,
  column: HTMLElement,
  body: HTMLElement,
  forkFrom: string | null,
) {
  const spacer = body.querySelector<HTMLElement>(".spacer")
  const first = body.querySelector<HTMLElement>(".msg")
  const fork =
    forkFrom === null
      ? undefined
      : [
          ...strip.querySelectorAll<HTMLElement>(
            `.msg[data-entry="${forkFrom}"]`,
          ),
        ].find(el => el.closest(".column") !== column)
  const shownIn = fork?.closest<HTMLElement>(".column-body")
  const top = body.getBoundingClientRect().top
  const plan = placement({
    fork:
      fork === undefined || shownIn === null || shownIn === undefined
        ? null
        : {
            top: fork.getBoundingClientRect().top - top,
            shownTo: shownIn.getBoundingClientRect().bottom - top,
          },
    first:
      first === null || spacer === null
        ? null
        : first.offsetTop - body.offsetTop - spacer.offsetHeight,
  })
  if (plan.kind === "end") {
    body.scrollTop = body.scrollHeight
    return
  }
  if (spacer !== null) spacer.style.height = `${plan.spacer}px`
  body.scrollTop = plan.scrollTop
}

/** How often a visible page refreshes its presence: well inside its 30 s decay. */
const PRESENCE_REFRESH_MS = 10_000

/** No open states: the workflow has not arrived. */
const NO_STATES: readonly WorkflowState[] = []

/** No lines: no canvas list. */
const NO_LINES: readonly string[] = []

/** No cards pinned to a canvas. */
const NO_PINS: readonly TextCard[] = []

/** No cards: a canvas whose canvas has not arrived. */
const NO_CANVAS: readonly CardOnCanvas[] = []

/** No canvas's state: the board has not arrived. */
const NO_STATE_OF: ReadonlyMap<CanvasId, WorkflowStateId> = new Map()
const NO_ARCHIVED: ReadonlyMap<CanvasId, ArchivedCanvas> = new Map()

export function App({
  session,
  stores,
}: {
  session: SessionClient
  stores: AppStores
}) {
  const doc = session.session
  const status = useDocStatus(doc)
  // The page over the stage, from the URL's hash.
  const page = usePage()
  // Your commands out now: the history's restore reads its own.
  const actingNow = useSyncExternalStore(
    session.acting.subscribe,
    session.acting.current,
  )
  // The roots this tab holds: the roots of the sidebar and the one
  // you are on, set by the effect below. Every read of the tree reads them
  // as one.
  const roots = useSyncExternalStore(
    session.roots.subscribe,
    session.roots.current,
  )
  const heldView = useMemo(
    () => ({
      session: session.session,
      live: session.live,
      roots: [...roots.values()],
    }),
    [session, roots],
  )
  // The directory of every root: what the sidebar, the board and
  // the inbox read of a root without holding it.
  const directory = useSelector(doc, readRoots)
  // Every read is `useSelector` over a named read, never an inline
  // `useTracked` thunk: a new thunk re-runs, so an inline one would read the
  // document again on every render, whatever caused it, and give every value
  // below a new identity.
  const {
    index,
    activity,
    running,
    live,
    seats,
    workflow,
    marks,
    noteColumns: noteTitles,
    threads,
    runEndReports,
    workFacts,
    asks,
    digests,
    histories,
    traces,
  } = useSelector(heldView, readSessionFacts)
  // Every card's record: the host's places, with this tab's moves
  // drawn over them until its copy holds them. An unchanged card keeps its
  // record object (`readPlaces`).
  const cards = useSyncExternalStore(
    session.cards.subscribe,
    session.cards.current,
  )
  // Each lane, with its queue from the cards: read again on every
  // change to the session, as a run's start or end is one, and to the
  // cards; a blank queued card does not wait.
  const blank = useBlankQueued(session, cards)
  const lanes = useSelector(
    heldView,
    useCallback(
      (v: HeldView) => readHeldLanes(v, readHeldIndex(v.roots), cards, blank),
      [cards, blank],
    ),
  )
  // Its own read, not part of the facts: every message compares `nameOf` by
  // identity, so it may change only when a name does.
  const nameOf = useSelector(doc, readParticipantNames)
  const pictures = useSelector(doc, readParticipantPictures)

  // Every canvas: its card on the board, its threads, from the
  // places, and their roots.
  const canvases = useMemo(
    () => canvasesOnBoard({ cards, threads }),
    [cards, threads],
  )
  // The canvases in the archive, from the board's cards and their
  // histories, the same map while it reads the same.
  const archived = useSameData(
    useMemo(
      () =>
        workflow === null
          ? NO_ARCHIVED
          : tasksInArchive(workflow, cards, histories),
      [workflow, cards, histories],
    ),
  )
  const { canvasOfThread, cardsOn, forkOf } = canvases.index
  // What a column says of its threads' work, its forks the canvas index's.
  const columnWork = useMemo(
    () => ({ ...workFacts, forks: forkOf }),
    [workFacts, forkOf],
  )
  // Each canvas with a message, for the board, and each canvas's label: its
  // title, else its first card's. Which canvases are in the sidebar
  // is yours (`openThreads`).
  const summaries = useMemo(
    () => taskSummaries(canvases, directory),
    [canvases, directory],
  )
  const labels = useMemo(
    () => taskLabels({ canvases, marks, directory, lanes: workFacts.lanes }),
    [canvases, marks, directory, workFacts.lanes],
  )
  // Who a mention can name: the names, and every writer held or in the
  // directory, so one who wrote only in a root not held counts.
  const participants = useMemo(
    () => participantsIn(nameOf, index, directory),
    [nameOf, index, directory],
  )
  // The messages in the roots this tab holds, of every root's: both from the
  // directory, so a held root still arriving counts as it will.
  const count = useMemo(
    () => messageCount(directory, new Set(roots.keys())),
    [directory, roots],
  )
  // Each root's root entry, held or not: where a lane running in a root this
  // tab does not hold rings it, and where its proposed changes' ⇡ goes.
  const rootEntries = useMemo(
    () => directoryRootEntries(directory),
    [directory],
  )
  // The canvases in the archive.
  const archivedCanvases = useMemo(() => new Set(archived.keys()), [archived])
  // The sidebar: your own document; a canvas the session does not
  // hold yet is left out until it does.
  const listIds = useSyncExternalStore(
    session.openThreads.canvases.subscribe,
    session.openThreads.canvases.current,
  )
  const list = useMemo(
    () => listIds.filter(canvas => canvases.byId.has(canvas)),
    [listIds, canvases],
  )
  // The board: each canvas's state.
  const board = useMemo(
    () => (workflow === null ? null : taskBoard(workflow, cards)),
    [workflow, cards],
  )
  const stateOf: ReadonlyMap<CanvasId, WorkflowStateId> =
    board?.stateOf ?? NO_STATE_OF
  const laneRoots = useMemo(
    () => laneRootEntries(workFacts.lanes, rootEntries),
    [workFacts.lanes, rootEntries],
  )
  // The agent's work in every thread, held or not, and so in every canvas:
  // one map for the sidebar, the board and each canvas's ring.
  const work = useMemo(() => threadWork({ lanes, running }), [lanes, running])
  const workOfCanvas = useMemo(
    () => canvasWork(work, canvasOfThread),
    [work, canvasOfThread],
  )
  // A canvas with no message has no label in `labels`.
  const labelOf = (canvas: CanvasId | null): string =>
    canvas === null ? NO_TEXT : (labels.get(canvas) ?? NO_TEXT)

  const [stored, dispatch] = useReducer(
    layoutReducer,
    undefined,
    () => stores.layout.load() ?? initialLayout(),
  )
  // Drawn from this render's facts, never `stored`: an effect runs a render
  // after the facts it reads, and a slow render painted new entries under an
  // old anchor. A layout change is resolved in the same render too, so
  // a column opened at a lane's tip is bound at once. The effect below stores
  // it, so an action reduces from it: React runs pending effects before it
  // handles the next event.
  // Each thread opened and not yet started: its column ends at
  // its fork, or a new canvas's at its root.
  const unstarted = useMemo(
    () =>
      unstartedThreads(
        threads,
        index,
        new Set(directory.keys()),
        session.writer,
      ),
    [threads, index, directory, session.writer],
  )
  // Each thread someone else holds: a branch not yet sent from
  // one is drawn without its entries.
  const holders = useMemo(
    () => heldByOthers(cards, session.writer),
    [cards, session.writer],
  )
  const layout = useMemo(
    () =>
      resolveLayout(stored, {
        index,
        lanes,
        archived: archivedCanvases,
        list,
        cardsOn,
        unstarted,
        holders,
      }),
    [stored, index, lanes, archivedCanvases, list, cardsOn, unstarted, holders],
  )
  useEffect(() => {
    if (layout !== stored)
      dispatch({
        kind: "resolve",
        index,
        lanes,
        archived: archivedCanvases,
        list,
        cardsOn,
        unstarted,
        holders,
      })
  }, [
    layout,
    stored,
    index,
    lanes,
    archivedCanvases,
    list,
    cardsOn,
    unstarted,
    holders,
  ])
  // Every change is saved, the document's too, so a restored column's anchor
  // is never older than the tree it was drawn from.
  useEffect(
    () => stores.layout.save(storedLayout(layout, cardsOn)),
    [stores, layout, cardsOn],
  )
  // Restored anchors the document lacks are dropped once, when it has
  // settled, and the tab to show is chosen then: before, missing means not
  // yet arrived. `"populated"` comes with the first data, so it cannot tell.
  // The roots of the sidebar's canvases and the stored canvas you were on are
  // held, and settled, first: their anchors are in no index before then.
  const [settled, setSettled] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the stored layout of that render
  useEffect(() => {
    let alive = true
    void whenSettled(doc).then(async () => {
      await session.placesSettled()
      const facts = readSessionFacts(heldView)
      session.holdRoots(
        planHeldRoots({
          layout: {
            active: stored.active,
            open: session.openThreads.canvases.current(),
          },
          canvases: canvasesOnBoard({
            cards: session.cards.current(),
            threads: facts.threads,
          }),
          inventory: inventoryThreads(session.cards.current(), session.writer),
        }),
      )
      await Promise.all(
        [...session.roots.current().values()].map(r => whenSettled(r)),
      )
      if (alive) setSettled(true)
    })
    return () => {
      alive = false
    }
  }, [doc, session])
  // The threads in your inventory, one list while they are the same.
  const heldKey = inventoryThreads(cards, session.writer).join(" ")
  const heldThreads = useMemo(
    () => (heldKey === "" ? [] : (heldKey.split(" ") as ThreadId[])),
    [heldKey],
  )
  // What this tab holds follows the sidebar, once the stored roots are settled.
  useEffect(() => {
    if (settled)
      session.holdRoots(
        planHeldRoots({ layout, canvases, inventory: heldThreads }),
      )
  }, [settled, session, layout, canvases, heldThreads])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled)
      dispatch({
        kind: "prune",
        index,
        lanes,
        archived: archivedCanvases,
        list,
        cardsOn,
        unstarted,
        holders,
        known: new Set(canvases.byId.keys()),
      })
  }, [settled])
  // A canvas the session stops holding (a thread lifted back into its card)
  // is pruned as at settle: its columns go, and a page on it
  // moves to the sidebar's last canvas.
  const known = useRef<ReadonlySet<CanvasId> | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the canvases changing, with the facts of that render
  useEffect(() => {
    if (!settled) return
    const now = new Set(canvases.byId.keys())
    const before = known.current
    known.current = now
    if (before !== null && [...before].some(t => !now.has(t)))
      dispatch({
        kind: "prune",
        index,
        lanes,
        archived: archivedCanvases,
        list,
        cardsOn,
        unstarted,
        holders,
        known: now,
      })
  }, [settled, canvases])

  const active = layout.active
  // The canvas's strip: its canvas column, then every card on its
  // canvas, in its order, folded or not, and your branches not yet sent.
  const strip: StripView | null = useMemo(
    () =>
      active?.kind === "canvas"
        ? canvasStrip(layout, active.canvas, {
            cardsOn,
            unstarted,
            holders,
            index,
            lanes,
          })
        : null,
    [layout, active, cardsOn, unstarted, index, lanes, holders],
  )
  // The canvas's thread columns drawn whole. Every projection below is keyed
  // on this one, so it keeps its identity while its data does: the strip is
  // rebuilt on every card's change, and another window's card redraws no
  // message list.
  const columns: readonly ColumnSpec[] = useSameData(
    useMemo(
      () => (strip !== null ? openColumns(stripCards(strip)) : []),
      [strip],
    ),
  )
  // The column you just opened, whose composer takes focus once when it
  // mounts (`claimFocus`). Never stored: a column restored, or shown again
  // with its tab, leaves focus where it is.
  const armed = useRef<FocusKey | null>(null)
  const takeFocus = useStable((key: FocusKey) => {
    const claim = claimFocus(armed.current, key)
    armed.current = claim.armed
    return claim.focus
  })

  const views = useMemo(
    () =>
      projectColumns(
        index,
        columns.map(c => {
          const held = unstartedMode(c)?.held
          return {
            anchor: c.anchor,
            ...(c.foldAbove === undefined ? {} : { foldAbove: c.foldAbove }),
            ...(held === undefined ? {} : { hide: held.thread }),
          }
        }),
      ),
    [index, columns],
  )
  // The cards pinned to the canvas you are on.
  const canvasPins = useMemo(
    () =>
      active?.kind === "canvas"
        ? canvasPinnedCards(cards, active.canvas)
        : NO_PINS,
    [active, cards],
  )
  // The canvas, and its note columns.
  const onCanvas = useMemo(
    () =>
      active?.kind === "canvas"
        ? (cardsOn.get(active.canvas) ?? NO_CANVAS)
        : [],
    [active, cardsOn],
  )
  // Every named thread on an open canvas, whose agents a mention may
  // reach, as the host builds them.
  const inReach = useMemo(
    () =>
      reachableAgents({
        cardsOn,
        archived: archivedCanvases,
        names: workFacts.names,
      }),
    [cardsOn, archivedCanvases, workFacts.names],
  )
  const noteViews = useMemo(
    () =>
      new Map(
        canvasNoteColumns({
          onCanvas: onCanvas,
          cards,
          titles: noteTitles,
        }).map(v => [v.column, v] as const),
      ),
    [onCanvas, cards, noteTitles],
  )
  // The canvas you are on, which the sidebar's repair keeps while it is
  // archived, and its threads' roots with their root entries, whose trees
  // the rail draws.
  const hereCanvas = active?.kind === "canvas" ? active.canvas : null
  const hereRoots = useMemo(
    () =>
      (hereCanvas === null
        ? []
        : (canvases.byId.get(hereCanvas)?.roots ?? [])
      ).flatMap(root => {
        const entry = rootEntries.get(root)
        return entry === undefined ? [] : [{ root, entry }]
      }),
    [hereCanvas, canvases, rootEntries],
  )
  useEffect(() => session.openThreads.here(hereCanvas), [session, hereCanvas])
  // The root whose colours the stage draws in: the canvas you are
  // on's first root, or the root its first thread will start, which its
  // record names.
  const seedRoot =
    hereCanvas === null
      ? null
      : (canvases.byId.get(hereCanvas)?.roots[0] ??
        (canvases.byId.get(hereCanvas)?.threads ?? [])
          .map(t => unstarted.get(t)?.root)
          .find(r => r !== undefined) ??
        null)
  const seed = seedRoot === null ? 0 : rootSeed(seedRoot)
  // Where each thread on the canvas ends, which the rail cuts its trees to:
  // its end, its lane's tip before its first entry, a copy's fork.
  const threadEnds = useMemo(
    () =>
      new Map(
        (hereCanvas === null
          ? []
          : (canvases.byId.get(hereCanvas)?.threads ?? [])
        ).flatMap(thread => {
          const end =
            threadAnchor(index, lanes, thread) ?? unstarted.get(thread)?.fork
          return end === undefined || end === null
            ? []
            : [[thread, end] as const]
        }),
      ),
    [hereCanvas, canvases, index, lanes, unstarted],
  )
  const canvasRailView = useMemo(
    () =>
      canvasRail({
        index,
        active,
        roots: hereRoots,
        ends: threadEnds,
        linkOf: thread => threadLink(thread, cards, session.writer),
        seed,
      }),
    [index, active, hereRoots, threadEnds, cards, session.writer, seed],
  )
  const rail = canvasRailView.rows
  const drawnStubs = useMemo(
    () =>
      canvasRailView.stubs.map(stub => ({
        stub,
        ...railStubWords(
          stub,
          workFacts.names,
          { me: session.writer, nameOf },
          canvas => labels.get(canvas) ?? NO_TEXT,
        ),
      })),
    [canvasRailView, workFacts.names, session.writer, nameOf, labels],
  )
  const order = useMemo(
    () => writerOrder(index, nameOf.keys()),
    [index, nameOf],
  )
  const colorOf = useMemo(() => presenceColors(order), [order])
  // Where your unsent cards are (step 2): your cards that hold
  // text, read from their texts, since a record outlives its text.
  const mine = useMemo(
    () => ownCards(session.writer, cards),
    [cards, session.writer],
  )
  const filled = useFilledCards(session, mine)
  const unsent = useMemo(
    () =>
      unsentSignals({
        mine,
        filled,
        layout,
        archived: archivedCanvases,
        canvases: canvases.index,
        index,
      }),
    [mine, filled, layout, archivedCanvases, canvases, index],
  )
  const yours = useMemo(
    () => ({ ends: unsent.ends, color: colorOf(session.writer) }),
    [unsent.ends, colorOf, session.writer],
  )
  // Each column's end, for the rail: one array while the views are the same.
  const ends = useMemo(() => views.map(v => v.tipId), [views])
  // What no fold hides in this tab's columns: the rail's landmarks.
  const landmarks = useMemo(
    () =>
      columnLandmarks(rail, {
        activity,
        ends,
        cards: yours.ends,
      }),
    [rail, activity, ends, yours.ends],
  )

  // `App` writes presence and reads none: a read here would render every
  // column on each write, the refresh and others' typing included.
  // Each part that shows presence reads it (`use-presence.ts`).
  //
  // Each column of the canvas you are on reports its thread end
  // (`planReading`), and its canvas, so a window that does not hold
  // the thread's root can name it. While the page is
  // visible the entries are refreshed, so they outlive their decay.
  const reported = useRef(new Map<string, string | null>())
  const reportedCanvas = useRef<CanvasId | null>(null)
  useEffect(() => {
    const now = new Map(
      columns.map((c, i) => [c.key, views[i]?.tipId ?? null] as const),
    )
    const writes = planReading(reported.current, now)
    for (const [key, end] of writes.set)
      session.setReading(key, end, hereCanvas)
    for (const key of writes.clear) session.clearReading(key)
    reported.current = now
    reportedCanvas.current = hereCanvas
  }, [columns, views, session, hereCanvas])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      for (const [key, end] of reported.current)
        if (end !== null) session.setReading(key, end, reportedCanvas.current)
    }
    const timer = setInterval(refresh, PRESENCE_REFRESH_MS)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [session])
  const lastTyped = useRef<TypedLast>({ at: 0, card: null })
  const typing = (end: string | null, card: CardId | null) => {
    const now = Date.now()
    if (end === null || !typingDue(lastTyped.current, now, card)) return
    lastTyped.current = { at: now, card }
    session.setTyping(end, card)
  }
  const tracks = useMemo(() => trackIndex(rail), [rail])
  const colors = useMemo(() => branchColors(tracks, views), [tracks, views])
  // A folded thread's colour: the track its column would take, at its end.
  const threadTrackOf = useCallback(
    (thread: ThreadId) => threadTrack(tracks, threadEnds.get(thread) ?? null),
    [tracks, threadEnds],
  )
  // Kept while its data is: the rail is rebuilt on every card's change, and
  // a message list compares its forks by identity.
  const forks = useSameData(colors.forks)
  const paths = useMemo(
    () => views.map(v => pathIds(index, v.tipId)),
    [index, views],
  )
  const shown = useMemo(() => new Set(paths.flatMap(p => [...p])), [paths])
  // The search of the canvas you are on, never stored. Its corpus,
  // result and matches are built only while it applies, and from the
  // deferred query, so typing stays quick on a long canvas.
  const [searchState, setSearch] = useState<SearchState | null>(null)
  const search = searchOn(searchState, active)
  const searchQuery = useDeferredValue(search?.query ?? "")
  const searchOpen = search !== null
  const corpus = useMemo(
    () => (searchOpen ? searchCorpus(index, rail) : null),
    [searchOpen, index, rail],
  )
  const searchResult = useMemo(() => {
    const query = parseQuery(searchQuery)
    return corpus === null || query === null ? null : searchTexts(corpus, query)
  }, [corpus, searchQuery])
  const since = search?.since ?? 0
  const matches = useMemo(
    () =>
      searchResult === null
        ? null
        : views.map(v =>
            columnMatches(v.nodes, searchResult, {
              index,
              asks,
              nameOf,
              since,
            }),
          ),
    [searchResult, views, index, asks, nameOf, since],
  )
  const searchWords = useMemo(
    () => searchLine(searchResult, shown),
    [searchResult, shown],
  )
  // The board lies over the columns, so a search there would find what no
  // one can see.
  const searchable = active?.kind === "canvas" && !layout.board
  const searchField = useRef<HTMLInputElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  const view = useMemo(
    () =>
      appView({
        active,
        columns,
        tracks: colors.track,
        archived,
        workflow,
        nameOf,
        proposedByLane: workFacts.proposedByLane,
        access: workFacts.access,
        lanes,
        laneRoots,
      }),
    [
      active,
      columns,
      colors.track,
      archived,
      workflow,
      nameOf,
      workFacts.proposedByLane,
      workFacts.access,
      lanes,
      laneRoots,
    ],
  )
  // Each thread column drawn whole, by its key: what the strip draws it from.
  const projected = useMemo(() => {
    const slots = view.stage.kind === "canvas" ? view.stage.slots : []
    return new Map(
      columns.flatMap((column, i) => {
        const columnView = views[i]
        const slot = slots[i]
        return columnView === undefined || slot === undefined
          ? []
          : [
              [
                column.key,
                {
                  at: i,
                  column,
                  view: columnView,
                  path: paths[i] ?? new Set<EntryId>(),
                  track: slot.track,
                  heldBy: unstartedMode(column)?.held?.by ?? null,
                  foreign: columnForeign(column, index, workFacts),
                  matches: search === null ? null : (matches?.[i] ?? null),
                },
              ] as const,
            ]
      }),
    )
  }, [view.stage, columns, views, paths, search, matches, index, workFacts])
  const proposed = useMemo(
    () =>
      openProposedByCanvas(view.openProposed, workFacts.names, canvasOfThread),
    [view.openProposed, workFacts.names, canvasOfThread],
  )

  // Your inbox: the messages that mention you, and which you have seen.
  const mentions = useMemo(
    () =>
      inboxMentions({
        roots: directory.values(),
        me: session.writer,
        myName: nameFor(nameOf, session.writer),
        participants,
      }),
    [directory, session.writer, nameOf, participants],
  )
  const inbox = useInbox({
    attention: session.attention,
    items: mentions,
    shown,
  })
  // What needs you, and where: each root's status, your inbox's
  // rows, and its count, which the page's title shows too.
  const attention = useAttention({
    me: session.writer,
    attention: session.attention,
    directory,
    runEndReports,
    openProposed: view.openProposed,
    sshAsks: view.sshAsks,
    owner: workFacts.project?.owner ?? null,
    running,
    lanes,
    archived: archivedCanvases,
    canvasOfThread,
    work,
    layout,
    settled,
  })
  const needsYou = inboxCount(attention.items, inbox.unseen)
  // A thread's icon, one lookup for the sidebar and the faces alike, so
  // they cannot disagree.
  const iconFor = useCallback(
    (thread: ThreadId) =>
      threadIcon({
        thread,
        names: workFacts.names,
        banners: workFacts.banners,
        icons: workFacts.icons,
      }),
    [workFacts.names, workFacts.banners, workFacts.icons],
  )
  const canvasIconsNow = useMemo(
    () => canvasIcons(canvases.index.threadsOf, iconFor),
    [canvases, iconFor],
  )
  // Every canvas card's header, once per canvas: the board and the sidebar
  // draw the same one.
  const heads = useMemo(
    () =>
      threadCardHeads(new Set([...summaries.keys(), ...layout.open]), {
        workflow,
        stateOf,
        labels,
        status: attention.status,
        pips: unsent.canvases,
        proposed,
        work: workOfCanvas,
      }),
    [
      summaries,
      layout.open,
      workflow,
      stateOf,
      labels,
      attention.status,
      unsent.canvases,
      proposed,
      workOfCanvas,
    ],
  )
  // The canvas column, from what the sidebar and the board read.
  const canvasColumn = useMemo(
    () =>
      strip === null
        ? null
        : canvasColumnView({
            canvas: strip[0].canvas,
            folded: strip[0].folded,
            head: heads.get(strip[0].canvas),
            mark: marks.get(strip[0].canvas),
            summary: summaries.get(strip[0].canvas),
            workflow,
            archived: archivedCanvases.has(strip[0].canvas),
            // The time is read as the list is drawn: a day's change waits
            // for the next change to the cards.
            trash: canvasTrash({
              cards,
              histories,
              canvas: strip[0].canvas,
              now: Date.now(),
              keepMs: TRASH_KEEP_MS,
              names: workFacts.names,
              noteTitles,
            }),
          }),
    [
      strip,
      heads,
      marks,
      summaries,
      workflow,
      archivedCanvases,
      cards,
      histories,
      workFacts.names,
      noteTitles,
    ],
  )
  // The canvas list the canvas's agents are told, read from no thread, and
  // what the agent of its first column last read of its pins.
  const told = useMemo(
    () =>
      strip === null
        ? NO_LINES
        : canvasLines(
            canvasList({
              canvas: strip[0].canvas,
              title: labels.get(strip[0].canvas) ?? NO_TEXT,
              onCanvas: onCanvas,
              reading: null,
              names: workFacts.names,
              work,
              noteTitles: new Map(
                [...noteViews].map(([id, v]) => [id, v.title] as const),
              ),
              noteCounts: new Map(
                [...noteViews].map(([id, v]) => [id, v.notes.length] as const),
              ),
              nameOf: w => nameFor(nameOf, w),
            }),
          ),
    [strip, labels, onCanvas, workFacts.names, work, noteViews, nameOf],
  )
  const canvasPinsInView = useMemo(
    () => canvasPinnedInView(index, views[0]?.tipId ?? null),
    [index, views],
  )
  const listView =
    active === null
      ? null
      : sidebarView({
          layout,
          active,
          heads,
          summaries,
          marks,
          archived: archivedCanvases,
          arrivals: attention.arrivals,
          icons: canvasIconsNow,
          workflow,
        })
  const title = pageTitle(needsYou, listView?.selected ?? null, page)
  // The board's search and "mine": never stored, so a filter outlives
  // closing the board but not a reload. One parse decides the filter
  // (`parseSearch`); the field's ref is for `/`, which `Board` hears.
  const [boardQuery, setBoardQuery] = useState("")
  const [boardMine, setBoardMine] = useState(false)
  const boardSearch = useMemo(
    () => parseSearch(boardQuery, boardMine),
    [boardQuery, boardMine],
  )
  const clearBoardFilter = useCallback(() => {
    setBoardQuery("")
    setBoardMine(false)
  }, [])
  const boardSearchField = useRef<HTMLInputElement>(null)
  const boardShown = useMemo(
    () =>
      workflow === null
        ? null
        : boardView({
            workflow,
            cards,
            summaries,
            heads,
            search: boardSearch,
            me: session.writer,
          }),
    [workflow, cards, summaries, heads, boardSearch, session.writer],
  )
  useEffect(() => {
    document.title = title
  }, [title])

  const stripEl = useRef<HTMLDivElement>(null)
  const narrow = useStripNarrow(stripEl)

  // Align each column once, when it appears. A column of another tab is
  // unmounted, so it is aligned again when its tab is shown. Columns are
  // placed left to right, the first at its end. A column mounts at the top,
  // and `useFollow` scrolls it to its end only in its ResizeObserver
  // callback, after this effect: unplaced, a column's parent would be
  // measured at its top, and a fork point far down it would need a spacer
  // taller than the screen.
  //
  // A column shown again with a spot (where it was left) goes back
  // there instead.
  const [spots] = useState(() => spotStore())
  const aligned = useRef(new Set<string>())
  useLayoutEffect(() => {
    const el = stripEl.current
    const keys = new Set(columns.map(c => c.key))
    for (const key of aligned.current)
      if (!keys.has(key)) aligned.current.delete(key)
    if (el === null) return
    for (const [i, column] of columns.entries()) {
      if (aligned.current.has(column.key)) continue
      aligned.current.add(column.key)
      const ids = views[i]?.nodes.map(n => n.id) ?? []
      const spot = spotFor(spots.load(), ids)
      if (
        spot === undefined ||
        !placeOnReturn(el, column.key, spot, ids.at(-1))
      )
        alignOnOpen(el, column.key, views[i]?.forkFrom ?? null)
    }
  }, [columns, views, spots])
  // Every mounted column's view, which the rail outlines.
  const [viewports] = useState(() => viewportStore())

  // What each column knew of its end when it was unmounted (`SeenEnd`), so a
  // column of a tab shown again shows ↓ new below for what arrived meanwhile.
  // Never pruned: an entry is small, and a closed column's key is never used
  // again, except `first-<root>`, which comes back as its root's only
  // column, placed at its end, and that clears ↓ new below.
  const [seenEnds] = useState(() => screenMemory<SeenEnd>())
  // What each tool row decided, by its call's id, so a tab shown again draws
  // its rows as they were left. Never pruned: a call id is not
  // reused.
  const [rows] = useState(() => screenMemory<RowMemory>())
  // Each ask's fold as its reader chose it, kept as rows are.
  const [folds] = useState(() => foldMemory())
  // What each proposal's card holds before a press, kept as rows are: edits
  // are the page's until a press sends them.
  const [proposalMemory] = useState(() => screenMemory<ProposalMemory>())
  // Each proposal's branches, read from the thread records once for every column.
  const proposalBranches = useMemo(() => branchesByProposal(threads), [threads])

  // After the alignment above: a picked message the alignment left out of
  // view is scrolled to.
  const reveal = useReveal(stripEl)
  const revealCard = useRevealCard(stripEl)
  const landed = useLanding(stripEl)

  // Your inventory: this tab's moves and your slots, the
  // panel's selection, whether it is open (never stored), and its dock
  // (this device's).
  const moves = useSyncExternalStore(
    session.moves.subscribe,
    session.moves.current,
  )
  const storedSlots = useSyncExternalStore(
    session.slots.subscribe,
    session.slots.current,
  )
  const held = useMemo(
    () => heldBy(cards, session.writer),
    [cards, session.writer],
  )
  const intents = useMemo(() => slotIntents(moves), [moves])
  // A thread's face: its slot's, and its column's when folded.
  const threadFaceOf = useCallback(
    (thread: ThreadId) =>
      threadFace({
        thread,
        index,
        lanes,
        names: workFacts.names,
        focuses: workFacts.focuses,
        iconFor,
      }),
    [index, lanes, workFacts.names, workFacts.focuses, iconFor],
  )
  // Each thread you hold, as its slot draws it.
  const threadFaces = useMemo(
    () =>
      new Map(
        held.flatMap(c =>
          c.kind === "thread" ? [[c.id, threadFaceOf(c.id)] as const] : [],
        ),
      ),
    [held, threadFaceOf],
  )
  const slots = useMemo(
    () =>
      settleSlots(
        held.map(c => c.id),
        storedSlots,
        intents,
      ),
    [held, storedSlots, intents],
  )
  const [selected, setSelected] = useState(0)
  // Each request to open the selected slot's card: a thread's preview.
  const [openSlot, setOpenSlot] = useState(0)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const openNow = useRef(false)
  openNow.current = inventoryOpen
  const [dock, setDock] = useState<Dock>(() => stores.dock.load() ?? "centre")
  useEffect(() => stores.dock.subscribe(d => setDock(d ?? "centre")), [stores])
  // The sidebar's width: your choice in this tab, else by the window's size.
  const [chosenWidth, setChosenWidth] = useState(() => stores.list.load())
  const listWidth = shownWidth(chosenWidth, useSmallWindow())
  useEffect(() => {
    document.documentElement.dataset.list = listWidth
  }, [listWidth])
  const [reviewPrefs, setReviewPrefs] = useState<ReviewPrefs>(
    () => stores.review.load() ?? NO_PREFS,
  )
  useEffect(
    () => stores.review.subscribe(p => setReviewPrefs(p ?? NO_PREFS)),
    [stores],
  )
  const saveReviewPrefs = useStable((p: ReviewPrefs) =>
    setReviewPrefs(stores.review.save(p)),
  )
  const reviewReach = useMemo(
    () => ({ prefs: reviewPrefs, setPrefs: saveReviewPrefs }),
    [reviewPrefs, saveReviewPrefs],
  )
  const fly = useFlight()
  const foldColumn = useFoldMotion(stripEl)
  // Each column's composer place (`composerPlace`), which a put lands in.
  const [composers] = useState(() => composerPlacesStore())
  // The column whose element last held focus: where a put by key lands.
  const lastColumn = useRef<string | null>(null)
  const [lastColumnKey, setLastColumnKey] = useState<string | null>(null)
  // The clipboard cell: the last copy this tab made.
  const [cell, setCell] = useState<Clip | null>(null)
  /** What the page holds of focus beside the DOM, read at each key, copy and paste. */
  const focusContext = useStable(
    (): FocusContext => ({
      selectedCard: slots[String(selected)] ?? null,
      column: lastColumn.current,
      page: page !== null,
      search: searchFocus(document.activeElement, searchable, searchOpen),
    }),
  )

  // An opened fold draws in its own ask (`AskWork`): a render of `App`
  // runs `useReveal`'s wait once it has.
  const [, setOpened] = useState(0)
  const foldOpened = useRef(false)
  // An entry to show once this tab holds its root (`planOpenIn`).
  const [whenHeld, setWhenHeld] = useState<EntryId | null>(null)
  const ports: AppPorts = {
    dispatch,
    session,
    attention: session.attention,
    // A fold opened before the reveal renders above the message: the reveal
    // waits for that render (`useReveal`'s `afterRender`).
    reveal: entry => {
      reveal(entry, foldOpened.current)
      foldOpened.current = false
    },
    revealCard,
    openWhenHeld: setWhenHeld,
    openFold: ask => {
      folds.set(ask, "open")
      foldOpened.current = true
      setOpened(n => n + 1)
    },
    arm: key => {
      armed.current = key
    },
    identity: stores.identity,
    reload: () => location.reload(),
    listWidth: width => {
      setChosenWidth(width)
      stores.list.save(width)
    },
    page: showPage,
    search: act => {
      // Closed from the bar, focus goes back to its 🔍; closed by a pick,
      // it stays where the pick left it.
      const fromBar = document.activeElement?.closest(".search-bar") != null
      setSearch(s => searchReducer(s, act, Date.now()))
      requestAnimationFrame(() => {
        if (act.kind === "open") searchField.current?.focus()
        if (act.kind === "close" && fromBar) searchToggle.current?.focus()
      })
    },
    landed,
    uploadBlob,
    clipboardCell: setCell,
    // As typed: the box's own text undo and its binding see an insert.
    insertText: text => {
      const box = document.activeElement
      if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement)
        box.setRangeText(
          text,
          box.selectionStart ?? box.value.length,
          box.selectionEnd ?? box.value.length,
          "end",
        )
      box?.dispatchEvent(new Event("input", { bubbles: true }))
    },
    inventory: {
      // A take into the inventory while the panel is closed shows it for the
      // card's flight.
      show: brief => {
        if (brief && openNow.current) return
        setInventoryOpen(true)
        if (brief) setTimeout(() => setInventoryOpen(false), FLIGHT_MS * 2)
      },
      select: setSelected,
      openSelected: () => setOpenSlot(n => n + 1),
    },
    fly,
    foldColumn,
    intent: intent => onIntent(intent),
  }
  /** Carry out `effects`: the one way anything below acts. */
  const run = useStable((effects: readonly Effect[]) => perform(effects, ports))
  /** What a plan reads: this render's layout and facts. */
  const intentState = useStable(
    (): IntentState => ({
      layout,
      index,
      asks,
      cards: {
        cards,
        lanes,
        me: session.writer,
        filled,
        slots,
        selected,
        composers: composers.current(),
      },
      canvases,
      listWidth,
      page,
      searching: searchOpen,
      clips: {
        textOf: card => session.cardText(card).text(),
        quoteOf: fetchedQuote,
        cell,
      },
    }),
  )
  /** What a reader asked for, planned from this render's layout and facts. */
  const onIntent = useStable((intent: Intent) =>
    run(
      planIntent(intent, intentState(), {
        key: crypto.randomUUID(),
        root: newRootId(),
        canvas: newCanvasId(),
        thread: newThreadId(),
        noteColumn: newNoteColumnId(),
        reference: newReferenceCardId(),
        text: newCardId(),
        branches: count => Array.from({ length: count }, () => newThreadId()),
      }),
    ),
  )
  useEffect(() => {
    if (whenHeld === null || index.entries[whenHeld] === undefined) return
    setWhenHeld(null)
    onIntent({ kind: "openAt", entry: whenHeld })
  }, [whenHeld, index, onIntent])
  // The keys (`keyAct`): decided there, from where focus is; nothing here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const intent = keyAct(e, focusFacts(focusContext()))
      if (intent === null) return
      e.preventDefault()
      onIntent(intent)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onIntent, focusContext])
  // A file dropped where no card takes it is refused, not opened in the tab.
  useFileDropGuard()
  // Copy, cut and paste: decided in `@pinetrie/interface` from
  // where focus is (`clipboard.ts`); nothing here.
  useClipboard({
    context: focusContext,
    facts: () => clipFacts(intentState()),
    onIntent,
  })
  // A link to an address in text: a past one opens its entry,
  // where its thread is; any other is followed by no page yet.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>("a[data-address]")
          : null
      if (link === null) return
      e.preventDefault()
      const address = parseAddress(link.dataset.address ?? "")
      if (address !== undefined && isPastAddress(address))
        onIntent({ kind: "openAt", entry: address.entry })
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [onIntent])
  // Where focus last was in a column: its key.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return
      const key = e.target.closest<HTMLElement>(".column")?.dataset.key
      if (key === undefined) return
      lastColumn.current = key
      setLastColumnKey(key)
    }
    document.addEventListener("focusin", onFocus)
    return () => document.removeEventListener("focusin", onFocus)
  }, [])
  // Every drag that starts in the page: a column's, a card's, a slot's, a
  // canvas's (`use-drag.ts`).
  useDrag({
    strip: stripEl,
    state: intentState,
    archive: workflow?.archive.id ?? null,
    onIntent,
  })
  /** A canvas's drag from the sidebar: its id and state. */
  const dragOf = (canvas: CanvasId): RootDrag => ({
    canvas,
    state: stateOf.get(canvas) ?? null,
  })
  const openAt = (entry: EntryId) => onIntent({ kind: "openAt", entry })
  /** Follow `link` to `entry`: a held thread's opens nothing. */
  const openLink = (entry: EntryId, link: ThreadLink) =>
    onIntent({ kind: "openLink", link, entry })

  // This device's name for you and the session's, made to agree once the
  // document has settled: before, a missing name means not yet arrived.
  const myName = nameOf.get(session.writer)
  useEffect(() => {
    if (!settled) return
    run(
      nameEffects(
        reconcileName(stores.identity.load(), session.principal, myName),
      ),
    )
  }, [settled, myName, session, stores, run])

  /** The props every column shares, whichever tab draws it. */
  const shared = {
    labelOf,
    activity,
    asks,
    folds,
    live,
    attention: session.attention,
    spots,
    viewports,
    digests,
    colorOf,
    cards,
    blank,
    composers,
    index,
    lanes,
    nameOf,
    participants,
    inReach,
    archived,
    rows,
    proposalMemory,
    proposalBranches,
    seats,
    session,
    traces,
    work: columnWork,
  }
  // What every card's history reads (`card-history.tsx`): one object while
  // its parts are the same, since every card's editor reads it.
  const historyFacts = useMemo(
    () => ({
      histories,
      seats,
      session,
      reader: { me: session.writer, nameOf },
    }),
    [histories, seats, session, nameOf],
  )

  const { stage } = view
  const readers = { session, index, canvasOfThread, order, nameOf, colorOf }
  const pip = <SignalMark color={colorOf(session.writer)} signal="unsent" />
  const reader = { me: session.writer, nameOf }
  /** Where a link to `thread` leads, as you follow it. */
  const linkOf = (thread: ThreadId) => threadLink(thread, cards, session.writer)
  const thread = threadRow({ index, labelOf, reader, onOpen: openLink })
  /**
   * A reader's thread, by the end they read at: a link to its thread, or,
   * where this tab holds no tree with that end, to the canvas's first thread,
   * which shows the canvas and the entry once it arrives; null for a canvas
   * with no thread on its canvas.
   */
  const readerRow = (end: EntryId, canvas: CanvasId) => {
    const first = cardsOn.get(canvas)?.find(c => c.kind === "thread")
    const at =
      entryThread(index, end) ?? (first?.kind === "thread" ? first.id : null)
    return at === null ? null : thread(end, end, linkOf(at))
  }
  return (
    <FocusClaim value={takeFocus}>
      <Pictures value={pictures}>
        <CardHistories value={historyFacts}>
          {listView !== null && stage.kind !== "connecting" ? (
            <Sidebar
              colorOf={colorOf}
              dragOf={dragOf}
              index={index}
              nameOf={nameOf}
              onIntent={onIntent}
              order={order}
              session={session}
              canvasOfThread={canvasOfThread}
              view={listView}
              width={listWidth}
            />
          ) : (
            <nav aria-label="your threads" id="sidebar" />
          )}
          {inventoryOpen && (
            <InventoryPanel
              colorOf={colorOf}
              column={lastColumnKey}
              dock={dock}
              held={held}
              intents={intents}
              onDock={d => setDock(stores.dock.save(d))}
              onIntent={onIntent}
              openRequest={openSlot}
              previewOf={thread =>
                threadPreview(thread, index, forkOf.get(thread)?.at ?? null)
              }
              notes={noteViews}
              threadNames={workFacts.names}
              threads={threadFaces}
              cell={clipboardCellView(cell, slots)}
              reader={{ me: session.writer, nameOf }}
              notices={moves.notices.filter(
                r => r.actedAt.kind === "inventory",
              )}
              selected={selected}
              session={session}
              slots={slots}
            />
          )}
          {/* Under a page the stage stays mounted and laid out, only inert.
          Remounted, its columns would lose their scroll; with
          `display: none`, `useStripNarrow` would measure the strip at 0 and
          turn an open pane into a modal dialog over the page. */}
          <main
            aria-hidden={page !== null || undefined}
            id="stage"
            inert={page !== null}
          >
            {/* What the stage's columns draw by: the
            root's colours, whether the pane covers the page, how you read a
            review. Each changes rarely, and only its readers redraw. */}
            <TrackSeed value={seed}>
              <ThreadStates value={workflow?.open ?? NO_STATES}>
                <NarrowContext value={narrow}>
                  <ReviewPrefsContext value={reviewReach}>
                    {listView === null || stage.kind === "connecting" ? (
                      <p className="connecting">connecting…</p>
                    ) : stage.kind === "nothing" ? (
                      <p className="nothing-here">
                        Open a thread from the board, or start one with ＋.
                      </p>
                    ) : (
                      <>
                        {search !== null && (
                          <SearchBar
                            field={searchField}
                            line={searchWords}
                            onIntent={onIntent}
                            query={search.query}
                          />
                        )}
                        <div className="stage-row">
                          <div className="rail-side">
                            {stage.kind === "canvas" && search === null && (
                              <div className="search-lead">
                                <SearchToggle
                                  onIntent={onIntent}
                                  open={false}
                                  toggle={searchToggle}
                                />
                              </div>
                            )}
                            {/* A canvas whose threads have no message yet, a new
                            tab's, draws a hollow dot where its
                            first message will be. */}
                            {rail.length > 0 ? (
                              <LiveRail
                                activity={activity}
                                asks={asks}
                                digests={digests}
                                revisions={workFacts.revisions}
                                colorOf={colorOf}
                                ends={ends}
                                index={index}
                                names={nameOf}
                                onPick={openAt}
                                open={shown}
                                matches={searchResult}
                                rows={rail}
                                session={session}
                                stubs={drawnStubs}
                                onLink={(link, at) =>
                                  onIntent({
                                    kind: "openLink",
                                    link,
                                    entry: at,
                                  })
                                }
                                viewports={viewports}
                                yours={yours}
                              />
                            ) : (
                              <EmptyRail />
                            )}
                          </div>
                          <Strip
                            onCanvas={onCanvas}
                            noteViews={noteViews}
                            threadFaceOf={threadFaceOf}
                            threadTrackOf={threadTrackOf}
                            onIntent={onIntent}
                            projected={projected}
                            reader={historyFacts.reader}
                            readers={readers}
                            shared={{
                              ...shared,
                              landmarks,
                              seenEnd: seenEnds,
                              forks,
                              onIntent,
                              shown,
                            }}
                            strip={strip}
                            stripRef={stripEl}
                            canvasColumn={canvasColumn}
                            canvasPins={canvasPins}
                            canvasPinsInView={canvasPinsInView}
                            told={told}
                            thread={readerRow}
                            typing={typing}
                            stage={stage}
                          />
                        </div>
                      </>
                    )}
                    {layout.board && boardShown !== null && (
                      <Board
                        notices={moves.notices.filter(
                          r => r.actedAt.kind === "board",
                        )}
                        reader={historyFacts.reader}
                        onClearFilter={clearBoardFilter}
                        onIntent={onIntent}
                        pip={pip}
                        readers={readers}
                        searchRef={boardSearchField}
                        thread={readerRow}
                        view={boardShown}
                      />
                    )}
                  </ReviewPrefsContext>
                </NarrowContext>
              </ThreadStates>
            </TrackSeed>
          </main>
          {page !== null && (
            <Page
              onBack={() => onIntent({ kind: "page", to: null })}
              page={page}
            >
              {page === "profile" && (
                <ProfilePage
                  email={session.principal}
                  nameOf={nameOf}
                  colorOf={colorOf}
                  rename={name => session.request({ kind: "name", name })}
                  setPicture={sha256 =>
                    session.request({ kind: "picture", sha256 })
                  }
                  writer={session.writer}
                />
              )}
              {page === "setup" && (
                <SetupPage
                  view={setupView(workFacts.setup, workFacts.commands)}
                />
              )}
              {page === "history" && (
                <HistoryPage
                  acting={restoreStatus(actingNow.restore)}
                  narrow={narrow}
                  restore={preview => void session.restore(preview)}
                  view={historyView({
                    states: workFacts.states,
                    accepted:
                      workFacts.accepted?.kind === "folder"
                        ? workFacts.accepted
                        : null,
                    personName: w => displayName(w, nameOf.get(w)),
                    laneName: lane => workFacts.names.get(lane) ?? lane,
                  })}
                />
              )}
            </Page>
          )}
          <Footer
            syncing={status === "pending"}
            strip={
              <BoardStrip
                count={count}
                elsewhere={attention.elsewhere}
                mine={boardMine}
                onIntent={onIntent}
                onMine={setBoardMine}
                onQuery={setBoardQuery}
                open={layout.board}
                pip={unsent.elsewhere ? pip : null}
                query={boardQuery}
                readers={readers}
                searchRef={boardSearchField}
                view={boardShown}
              />
            }
            colorOf={colorOf}
            nameOf={nameOf}
            inbox={{
              attention: attention.items,
              count: needsYou,
              mentions,
              inbox,
              thread,
              names: workFacts.names,
              linkOf,
              labelOf,
              reader,
              onOpen: openLink,
              onIntent,
            }}
            accepted={workFacts.accepted}
            onIntent={onIntent}
            me={{ writer: session.writer, email: session.principal }}
            session={session}
            inventory={{
              open: inventoryOpen,
              count: held.length,
              onToggle: () => setInventoryOpen(open => !open),
            }}
            folded={listWidth === "icons"}
          />
        </CardHistories>
      </Pictures>
    </FocusClaim>
  )
}
