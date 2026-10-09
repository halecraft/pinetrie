// web/app — the page: `App`, which `main.tsx` mounts.
//
// The screen is the sidebar down the left, the root you are on beside it, a
// rail beside a strip of columns, and the footer along the bottom: you, the
// board's strip, what needs you and publish (docs/06-interface.md,
// ADR-0122). The rail draws the root's tree; each column is one path, read on
// its own scroll; the board opens over them. What is drawn is a read of the
// document, through `@pinetrie/reads` and `projection.ts`. The sidebar is your
// own document, on every device (`openThreads`). Which root you are on, each
// root's columns and whether the board is open are this window's own view
// state: a reducer (`layout.ts`), kept in this browser tab's storage and
// never in the document (ADR-0027).
//
// `App` gathers, `appView` (`app-view.ts`) decides what is shown, and a click
// comes back as an `Intent`, which `planIntent` (`intent.ts`) plans and
// `perform` carries out.
//
// The renderer before React rebuilt the transcript with `innerHTML` on every
// change, which destroyed focus and selection on every keystroke. React gives
// stable node identity, which `useText` needs to keep a card's textarea
// bound while everyone types (ADR-0048).

import { whenSettled } from "@kyneta/exchange"
import { useDocStatus, useSelector } from "@kyneta/react"
import {
  type CardId,
  type EntryId,
  parseCardId,
  pathIds,
  type TaskId,
  type TextCard,
  taskPinnedInView,
  type WorkflowState,
  type WorkflowStateId,
} from "@pinetrie/core"
import {
  type AppPorts,
  appView,
  BOARD_SEARCH,
  boardView,
  branchColors,
  CARD_MIME,
  type Column as ColumnSpec,
  cardMarks,
  claimFocus,
  columnLandmarks,
  composerPlacesStore,
  type Dock,
  DROP_ZONE,
  type Effect,
  foldMemory,
  type HeldView,
  hereRail,
  type Identity,
  type Intent,
  inboxCount,
  initialLayout,
  keyAct,
  type Layout,
  type ListWidth,
  labelsOf,
  laneRootsOf,
  layoutReducer,
  mentionsOf,
  messageCount,
  NO_TEXT,
  nameEffects,
  noteColumnsOf,
  offeredByTask,
  openColumns,
  ownCards,
  pageTitle,
  parseSearch,
  perform,
  placeAt,
  placement,
  planHeldRoots,
  planIntent,
  planReading,
  projectColumns,
  type RootDrag,
  type RowMemory,
  readHeldLanes,
  readSessionFacts,
  reconcileName,
  resolveLayout,
  rootEntriesOf,
  rootSeed,
  type SeenEnd,
  type Spot,
  type Strip as StripView,
  screenMemory,
  shownWidth,
  sidebarView,
  spotFor,
  spotStore,
  storedLayout,
  stripCards,
  summariesOf,
  type TypedLast,
  targetOfElement,
  taskColumnView,
  taskSprites,
  taskStrip,
  tasksOf,
  taskWork,
  threadCardHeads,
  threadWork,
  typingDue,
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
  boardOf,
  type CanvasCard,
  canvasLines,
  canvasList,
  taskPinnedOf,
} from "@pinetrie/rules"
import {
  heldBy,
  intentsOf,
  newNoteColumnId,
  newRootId,
  newTaskId,
  newThreadId,
  type SessionClient,
  settleSlots,
} from "@pinetrie/session"
import {
  useCallback,
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
import { CardPip } from "./card-pip.tsx"
import { Footer } from "./footer.tsx"
import { threadRow } from "./inbox-menu.tsx"
import { InventoryPanel } from "./inventory-panel.tsx"
import { Page } from "./page.tsx"
import { TrackSeed } from "./palette-context.ts"
import { Pictures } from "./pictures-context.ts"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { ProfilePage } from "./profile-page.tsx"
import { EmptyRail, LiveRail } from "./rail.tsx"
import {
  NO_PREFS,
  type ReviewPrefs,
  ReviewPrefsContext,
} from "./review-prefs.ts"
import { Sidebar } from "./sidebar.tsx"
import { Strip } from "./strip.tsx"
import type { DeviceState, TabState } from "./tab-state.ts"
import { isTextBox } from "./text-box.ts"
import { ThreadStates } from "./thread-states.ts"
import { useAttention } from "./use-attention.ts"
import { useBlankQueued } from "./use-blank-queued.ts"
import { useColumnDrag } from "./use-column-drag.ts"
import { useFilledCards } from "./use-filled-cards.ts"
import { FLIGHT_MS, useFlight } from "./use-flight.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { NarrowContext, useStripNarrow } from "./use-narrow.ts"
import { goTo, usePage } from "./use-page.ts"
import { useReveal, useRevealCard } from "./use-reveal.ts"
import { useRootDrag } from "./use-root-drag.ts"
import { useSmallWindow } from "./use-small-window.ts"
import { useStable } from "./use-stable.ts"

/** What `App` keeps on this device and tab, built by `main.tsx`. */
export interface AppStores {
  readonly layout: TabState<Layout>
  readonly identity: DeviceState<Identity>
  /** Where the inventory panel is docked, on this device (ADR-0048). */
  readonly dock: DeviceState<Dock>
  /** How you read a review, on this device (ADR-0087). */
  readonly review: DeviceState<ReviewPrefs>
  /** The sidebar full or folded to icons, chosen in this tab (ADR-0088). */
  readonly list: TabState<ListWidth>
}

/** How long a card's drag held over a root in the sidebar opens it. */
const ITEM_HOVER_MS = 600

const cardOrNull = (id: string | undefined): CardId | null =>
  id === undefined ? null : (parseCardId(id) ?? null)

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
 * Bring a column shown again back to where it was left (`placeAt`,
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
  const to = placeAt(spot, {
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

/** No lines: no task's canvas list. */
const NO_LINES: readonly string[] = []

/** No cards pinned to a task. */
const NO_PINS: readonly TextCard[] = []

/** No cards: a task whose canvas has not arrived. */
const NO_CANVAS: readonly CanvasCard[] = []

/** No task's state: the board has not arrived. */
const NO_STATE_OF: ReadonlyMap<TaskId, WorkflowStateId> = new Map()

export function App({
  session,
  stores,
}: {
  session: SessionClient
  stores: AppStores
}) {
  const doc = session.session
  const status = useDocStatus(doc)
  // The page over the workspace, from the URL's hash (ADR-0098).
  const page = usePage()
  // The roots this tab holds (ADR-0063): the roots of the sidebar and the one
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
  // The directory of every root (ADR-0063): what the sidebar, the board and
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
    places,
    archived,
    marks,
    noteColumns: noteTitles,
    tasks: taskRecords,
    threads,
    verdicts,
    workFacts,
    asks,
    stops,
    digests,
    histories,
    traces,
  } = useSelector(heldView, readSessionFacts)
  // Every card's record (ADR-0059): the host's places, with this tab's moves
  // drawn over them until its copy holds them. An unchanged card keeps its
  // record object (`readPlaces`).
  const cards = useSyncExternalStore(
    session.cards.subscribe,
    session.cards.current,
  )
  // Each lane, with its queue from the cards (ADR-0048): read again on every
  // change to the session, as a run's start or end is one, and to the
  // cards; a blank queued card does not wait (ADR-0113).
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

  // Every task (ADR-0116): its threads, from the places, and their roots.
  const tasks = useMemo(
    () => tasksOf({ known: taskRecords.keys(), cards, threads }),
    [taskRecords, cards, threads],
  )
  const { taskOfThread, canvases } = tasks.index
  // Each task with a message, for the board, and each task's label: its
  // title, else its first card's (ADR-0045). Which tasks are in the sidebar
  // is yours (`openThreads`, ADR-0122).
  const summaries = useMemo(
    () => summariesOf(tasks, directory),
    [tasks, directory],
  )
  const labels = useMemo(
    () => labelsOf({ tasks, marks, directory, lanes: workFacts.lanes }),
    [tasks, marks, directory, workFacts.lanes],
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
  // Each root's root entry, held or not (ADR-0063): where a lane running in
  // a root this tab does not hold rings it, and where its offer's ⇡ goes.
  const rootEntries = useMemo(() => rootEntriesOf(directory), [directory])
  // The tasks in the archive (ADR-0122).
  const archivedTasks = useMemo(() => new Set(archived.keys()), [archived])
  // The sidebar (ADR-0122): your own document; a task the session does not
  // hold yet is left out until it does.
  const listIds = useSyncExternalStore(
    session.openThreads.tasks.subscribe,
    session.openThreads.tasks.current,
  )
  const list = useMemo(
    () => listIds.filter(task => tasks.byId.has(task)),
    [listIds, tasks],
  )
  // The board (ADR-0122): each task's state.
  const board = useMemo(
    () =>
      workflow === null ? null : boardOf(workflow, places, summaries.keys()),
    [workflow, places, summaries],
  )
  const stateOf: ReadonlyMap<TaskId, WorkflowStateId> =
    board?.stateOf ?? NO_STATE_OF
  const laneRoots = useMemo(
    () => laneRootsOf(workFacts.lanes, rootEntries),
    [workFacts.lanes, rootEntries],
  )
  // The agent's work in every thread, held or not, and so in every task:
  // one map for the sidebar, the board and each task's ring (ADR-0091).
  const work = useMemo(() => threadWork({ lanes, running }), [lanes, running])
  const workOfTask = useMemo(
    () => taskWork(work, taskOfThread),
    [work, taskOfThread],
  )
  // A task with no message has no label in `labels`.
  const labelOf = (task: TaskId | null): string =>
    task === null ? NO_TEXT : (labels.get(task) ?? NO_TEXT)

  const [stored, dispatch] = useReducer(
    layoutReducer,
    undefined,
    () => stores.layout.load() ?? initialLayout(),
  )
  // Drawn from this render's facts, never `stored`: an effect runs a render
  // after the facts it reads, and a slow render painted new entries under an
  // old anchor (S35). A layout change is resolved in the same render too, so
  // a column opened at a lane's tip is bound at once. The effect below stores
  // it, so an action reduces from it: React runs pending effects before it
  // handles the next event.
  const layout = useMemo(
    () =>
      resolveLayout(stored, {
        index,
        lanes,
        archived: archivedTasks,
        list,
        canvases,
      }),
    [stored, index, lanes, archivedTasks, list, canvases],
  )
  useEffect(() => {
    if (layout !== stored)
      dispatch({
        kind: "resolve",
        index,
        lanes,
        archived: archivedTasks,
        list,
        canvases,
      })
  }, [layout, stored, index, lanes, archivedTasks, list, canvases])
  // Every change is saved, the document's too, so a restored column's anchor
  // is never older than the tree it was drawn from.
  useEffect(
    () => stores.layout.save(storedLayout(layout, canvases)),
    [stores, layout, canvases],
  )
  // Restored anchors the document lacks are dropped once, when it has
  // settled, and the tab to show is chosen then: before, missing means not
  // yet arrived. `"populated"` comes with the first data, so it cannot tell
  // (S29).
  // The roots of the sidebar's tasks and the stored task you were on are
  // held, and settled, first: their anchors are in no index before
  // (ADR-0063).
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
            open: session.openThreads.tasks.current(),
          },
          tasks: tasksOf({
            known: facts.tasks.keys(),
            cards: session.cards.current(),
            threads: facts.threads,
          }),
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
  // What this tab holds follows the sidebar, once the stored roots are settled.
  useEffect(() => {
    if (settled) session.holdRoots(planHeldRoots({ layout, tasks }))
  }, [settled, session, layout, tasks])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled)
      dispatch({
        kind: "prune",
        index,
        lanes,
        archived: archivedTasks,
        list,
        canvases,
        known: new Set(tasks.byId.keys()),
      })
  }, [settled])
  // A task the session stops holding (a thread lifted back into its card,
  // ADR-0111) is pruned as at settle: its columns go, and a page on it
  // moves to the sidebar's last task.
  const known = useRef<ReadonlySet<TaskId> | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the tasks changing, with the facts of that render
  useEffect(() => {
    if (!settled) return
    const now = new Set(tasks.byId.keys())
    const before = known.current
    known.current = now
    if (before !== null && [...before].some(t => !now.has(t)))
      dispatch({
        kind: "prune",
        index,
        lanes,
        archived: archivedTasks,
        list,
        canvases,
        known: now,
      })
  }, [settled, tasks])

  const active = layout.active
  // The task's strip (ADR-0116): its task column, then every card on its
  // canvas, in its order, folded or not, and your branches not yet sent.
  const strip: StripView | null = useMemo(
    () =>
      active?.kind === "task"
        ? taskStrip(layout, active.task, { canvases, index, lanes })
        : null,
    [layout, active, canvases, index, lanes],
  )
  // The tab's thread columns drawn whole: the task's, or a new tab's one
  // fresh column. Every projection below is keyed on this one.
  const columns: readonly ColumnSpec[] = useMemo(
    () =>
      strip !== null
        ? openColumns(stripCards(strip))
        : active?.kind === "new"
          ? layout.newTabs.filter(c => c.key === active.key)
          : [],
    [strip, layout, active],
  )
  // The column you just opened, whose composer takes focus once when it
  // mounts (`claimFocus`). Never stored: a column restored, or shown again
  // with its tab, leaves focus where it is.
  const armed = useRef<string | null>(null)
  const takeFocus = (key: string) => {
    const claim = claimFocus(armed.current, key)
    armed.current = claim.armed
    return claim.focus
  }

  const views = useMemo(
    () =>
      projectColumns(
        index,
        columns.map(c => ({ anchor: c.anchor })),
      ),
    [index, columns],
  )
  // The cards pinned to the task you are on (ADR-0116).
  const taskPins = useMemo(
    () =>
      active?.kind === "task" ? taskPinnedOf(cards, active.task) : NO_PINS,
    [active, cards],
  )
  // The task's canvas, and its note columns (ADR-0116).
  const canvas = useMemo(
    () =>
      active?.kind === "task" ? (canvases.get(active.task) ?? NO_CANVAS) : [],
    [active, canvases],
  )
  const noteViews = useMemo(
    () =>
      new Map(
        noteColumnsOf({ canvas, cards, titles: noteTitles }).map(
          v => [v.column, v] as const,
        ),
      ),
    [canvas, cards, noteTitles],
  )
  // The task you are on, which the sidebar's repair keeps while it is
  // archived, and the root entries of its threads' roots, whose trees the
  // rail draws.
  const hereTask = active?.kind === "task" ? active.task : null
  const hereRoots = useMemo(
    () =>
      (hereTask === null
        ? []
        : (tasks.byId.get(hereTask)?.roots ?? [])
      ).flatMap(root => rootEntries.get(root) ?? []),
    [hereTask, tasks, rootEntries],
  )
  const rail = useMemo(
    () => hereRail(index, active, hereRoots),
    [index, active, hereRoots],
  )
  useEffect(() => session.openThreads.here(hereTask), [session, hereTask])
  // The root whose colours the workspace draws in (ADR-0089): the task
  // you are on's first root, or the root a new tab will start, whose id it
  // minted as it opened.
  const seedRoot =
    (hereTask === null ? undefined : tasks.byId.get(hereTask)?.roots[0]) ??
    (active?.kind === "new"
      ? (layout.newTabs.find(c => c.key === active.key)?.fresh?.root ?? null)
      : null)
  const seed = seedRoot === null ? 0 : rootSeed(seedRoot)
  const order = useMemo(
    () => writerOrder(index, nameOf.keys()),
    [index, nameOf],
  )
  const colorOf = useMemo(() => presenceColors(order), [order])
  // Where your unsent cards are (ADR-0048, step 2): your cards that hold
  // text, read from their texts, since a record outlives its text.
  const mine = useMemo(
    () => ownCards(session.writer, cards),
    [cards, session.writer],
  )
  const filled = useFilledCards(session, mine)
  const unsent = useMemo(
    () =>
      cardMarks({
        mine,
        filled,
        layout,
        archived: archivedTasks,
        tasks: tasks.index,
        index,
      }),
    [mine, filled, layout, archivedTasks, tasks, index],
  )
  const yours = useMemo(
    () => ({ ends: unsent.ends, color: colorOf(session.writer) }),
    [unsent.ends, colorOf, session.writer],
  )
  // Each column's end, for the rail: one array while the views are the same.
  const ends = useMemo(() => views.map(v => v.tipId), [views])
  // What no fold hides in this tab's columns: the rail's landmarks (ADR-0106).
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
  // column on each write, the refresh and others' typing included (S59).
  // Each part that shows presence reads it (`use-presence.ts`).
  //
  // Each column of the task you are on reports its thread end (ADR-0024,
  // ADR-0029; `planReading`), and its task, so a window that does not hold
  // the thread's root can name it (ADR-0063, ADR-0116). While the page is
  // visible the entries are refreshed, so they outlive their decay.
  const reported = useRef(new Map<string, string | null>())
  const reportedTask = useRef<TaskId | null>(null)
  useEffect(() => {
    const now = new Map(
      columns.map((c, i) => [c.key, views[i]?.tipId ?? null] as const),
    )
    const writes = planReading(reported.current, now)
    for (const [key, end] of writes.set) session.setReading(key, end, hereTask)
    for (const key of writes.clear) session.clearReading(key)
    reported.current = now
    reportedTask.current = hereTask
  }, [columns, views, session, hereTask])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      for (const [key, end] of reported.current)
        if (end !== null) session.setReading(key, end, reportedTask.current)
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
  const colors = useMemo(() => branchColors(rail, views), [rail, views])
  const paths = useMemo(
    () => views.map(v => pathIds(index, v.tipId)),
    [index, views],
  )
  const shown = useMemo(() => new Set(paths.flatMap(p => [...p])), [paths])
  const view = useMemo(
    () =>
      appView({
        active,
        columns,
        tracks: colors.track,
        archived,
        workflow,
        nameOf,
        offers: workFacts.offers,
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
      workFacts.offers,
      lanes,
      laneRoots,
    ],
  )
  // Each thread column drawn whole, by its key: what the strip draws it from.
  const projected = useMemo(() => {
    const slots =
      view.workspace.kind === "task" || view.workspace.kind === "new"
        ? view.workspace.slots
        : []
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
                  closable: slot.closable,
                  track: slot.track,
                },
              ] as const,
            ]
      }),
    )
  }, [view.workspace, columns, views, paths])
  const offered = useMemo(
    () => offeredByTask(view.offers, workFacts.names, taskOfThread),
    [view.offers, workFacts.names, taskOfThread],
  )

  // Your inbox: the messages that mention you, and which you have seen.
  const mentions = useMemo(
    () =>
      mentionsOf({
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
  // What needs you, and where (ADR-0077): each root's status, your inbox's
  // rows, and its count, which the page's title shows too (ADR-0091).
  const attention = useAttention({
    me: session.writer,
    attention: session.attention,
    directory,
    verdicts,
    offers: view.offers,
    running,
    lanes,
    archived: archivedTasks,
    taskOfThread,
    work,
    layout,
    settled,
  })
  const needsYou = inboxCount(attention.items, inbox.unseen)
  const sprites = useMemo(
    () => taskSprites(tasks.index.threadsOf, workFacts.banners),
    [tasks, workFacts.banners],
  )
  // Every task card's header, once per task: the board and the sidebar
  // draw the same one (ADR-0111).
  const heads = useMemo(
    () =>
      threadCardHeads(new Set([...summaries.keys(), ...layout.open]), {
        workflow,
        stateOf,
        labels,
        status: attention.status,
        pips: unsent.tasks,
        offered,
        work: workOfTask,
      }),
    [
      summaries,
      layout.open,
      workflow,
      stateOf,
      labels,
      attention.status,
      unsent.tasks,
      offered,
      workOfTask,
    ],
  )
  // The task column (ADR-0116), from what the sidebar and the board read.
  const taskColumn = useMemo(
    () =>
      strip === null
        ? null
        : taskColumnView({
            task: strip[0].task,
            folded: strip[0].folded,
            head: heads.get(strip[0].task),
            mark: marks.get(strip[0].task),
            summary: summaries.get(strip[0].task),
            workflow,
            archived: archivedTasks.has(strip[0].task),
          }),
    [strip, heads, marks, summaries, workflow, archivedTasks],
  )
  // The canvas list the task's agents are told, read from no thread, and
  // what the agent of its first column last read of its pins (ADR-0116).
  const told = useMemo(
    () =>
      strip === null
        ? NO_LINES
        : canvasLines(
            canvasList({
              task: strip[0].task,
              title: labels.get(strip[0].task) ?? NO_TEXT,
              canvas,
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
    [strip, labels, canvas, workFacts.names, work, noteViews, nameOf],
  )
  const taskPinsInView = useMemo(
    () => taskPinnedInView(index, views[0]?.tipId ?? null),
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
          archived: archivedTasks,
          unsent,
          arrivals: attention.arrivals,
          sprites,
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
            places,
            summaries,
            heads,
            search: boardSearch,
            me: session.writer,
          }),
    [workflow, places, summaries, heads, boardSearch, session.writer],
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
  // A column shown again with a spot (where it was left, ADR-0058) goes back
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
  // Every mounted column's view, which the rail outlines (ADR-0058).
  const [viewports] = useState(() => viewportStore())

  // What each column knew of its end when it was unmounted (`SeenEnd`), so a
  // column of a tab shown again shows ↓ new below for what arrived meanwhile.
  // Never pruned: an entry is small, and a closed column's key is never used
  // again, except `first-<root>`, which comes back as its root's only
  // column, placed at its end, and that clears ↓ new below.
  const [seenEnds] = useState(() => screenMemory<SeenEnd>())
  // What each tool row decided, by its call's id, so a tab shown again draws
  // its rows as they were left (ADR-0123). Never pruned: a call id is not
  // reused.
  const [rows] = useState(() => screenMemory<RowMemory>())
  // Each ask's fold as its reader chose it (ADR-0106), kept as rows are.
  const [folds] = useState(() => foldMemory())

  // After the alignment above: a picked message the alignment left out of
  // view is scrolled to.
  const reveal = useReveal(stripEl)
  const revealCard = useRevealCard(stripEl)

  // Your inventory (ADR-0048 step 4): this tab's moves and your slots, the
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
  const intents = useMemo(() => intentsOf(moves), [moves])
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
  // Each column's composer place (`composerPlace`), which a put lands in.
  const [composers] = useState(() => composerPlacesStore())
  // The column whose element last held focus: where a put by key lands.
  const lastColumn = useRef<string | null>(null)
  const [lastColumnKey, setLastColumnKey] = useState<string | null>(null)

  // An opened fold draws in its own ask (`AskWork`): a render of `App`
  // runs `useReveal`'s wait once it has.
  const [, setOpened] = useState(0)
  // An entry to show once this tab holds its root (`openIn`, ADR-0063).
  const [whenHeld, setWhenHeld] = useState<EntryId | null>(null)
  const ports: AppPorts = {
    dispatch,
    session,
    attention: session.attention,
    reveal,
    revealCard,
    openWhenHeld: setWhenHeld,
    openFold: ask => {
      folds.set(ask, "open")
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
    page: goTo,
    inventory: {
      // A take into the inventory while the panel is closed shows it for the
      // card's flight.
      show: brief => {
        if (brief && openNow.current) return
        setInventoryOpen(true)
        if (brief) setTimeout(() => setInventoryOpen(false), FLIGHT_MS * 2)
      },
      select: setSelected,
    },
    fly,
    intent: intent => onIntent(intent),
  }
  /** Carry out `effects`: the one way anything below acts. */
  const run = useStable((effects: readonly Effect[]) => perform(effects, ports))
  /** What a reader asked for, planned from this render's layout and facts. */
  const onIntent = useStable((intent: Intent) =>
    run(
      planIntent(
        intent,
        {
          layout,
          index,
          asks,
          cards: {
            cards,
            lanes,
            laneRecords: workFacts.lanes,
            me: session.writer,
            filled,
            slots,
            selected,
            composers: composers.current(),
          },
          tasks,
          listWidth,
          page,
        },
        {
          key: crypto.randomUUID(),
          root: newRootId(),
          task: newTaskId(),
          thread: newThreadId(),
          noteColumn: newNoteColumnId(),
        },
      ),
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
      const el = document.activeElement
      const intent = keyAct(e, {
        card:
          el instanceof HTMLElement
            ? cardOrNull(el.closest<HTMLElement>("[data-card]")?.dataset.card)
            : null,
        inText: isTextBox(el),
        inPanel: el?.closest(".inventory") != null,
        selectedCard: slots[String(selected)] ?? null,
        column: lastColumn.current,
        page: page !== null,
      })
      if (intent === null) return
      e.preventDefault()
      onIntent(intent)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onIntent, selected, slots, page])
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
  // A card's drag (HTML drag and drop: it crosses elements and roots). A
  // drop lands only where put can (`targetOfElement`); held over a root in
  // the sidebar, the drag opens it, and held over ▦, the board, to drop it
  // on a state there (ADR-0111). A root's drag is not a card's: it is
  // `ROOT_MIME`, and lands by `useRootDrag`.
  useEffect(() => {
    let hover: {
      readonly over: TaskId | "board"
      readonly timer: ReturnType<typeof setTimeout>
    } | null = null
    const carriesCard = (e: DragEvent) =>
      e.dataTransfer?.types.includes(CARD_MIME) === true
    const targetOf = (e: DragEvent) => {
      const el =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(DROP_ZONE)
          : null
      return el === null ? null : targetOfElement(el)
    }
    const onOver = (e: DragEvent) => {
      if (!carriesCard(e)) return
      const item =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(".open-root[data-task]")?.dataset.task
          : undefined
      // The item's task, as the sidebar holds it, or ▦.
      const board =
        e.target instanceof Element &&
        e.target.closest(".board-toggle") !== null
      const over = board ? "board" : layout.open.find(r => r === item)
      if (over !== hover?.over) {
        if (hover !== null) clearTimeout(hover.timer)
        const opens: Intent | null =
          over === undefined
            ? null
            : over === "board"
              ? { kind: "board", open: true, focus: false }
              : { kind: "show", here: { kind: "task", task: over } }
        hover =
          over === undefined || opens === null
            ? null
            : {
                over,
                timer: setTimeout(() => onIntent(opens), ITEM_HOVER_MS),
              }
      }
      if (targetOf(e) !== null) e.preventDefault()
    }
    // While a card is dragged, the page says so (`data-card-drag`): an empty
    // pinned strip shows only then, as somewhere to drop it.
    const dragging = (on: boolean) => {
      if (on) document.body.dataset.cardDrag = ""
      else delete document.body.dataset.cardDrag
    }
    const onEnter = (e: DragEvent) => {
      if (carriesCard(e)) dragging(true)
    }
    const onEnd = () => dragging(false)
    const onDrop = (e: DragEvent) => {
      dragging(false)
      const target = targetOf(e)
      const card = parseCardId(e.dataTransfer?.getData(CARD_MIME) ?? "")
      if (target === null || card === undefined) return
      e.preventDefault()
      onIntent({ kind: "put", card, target })
    }
    document.addEventListener("dragover", onOver)
    document.addEventListener("dragenter", onEnter)
    document.addEventListener("dragend", onEnd)
    document.addEventListener("drop", onDrop)
    return () => {
      if (hover !== null) clearTimeout(hover.timer)
      dragging(false)
      document.removeEventListener("dragover", onOver)
      document.removeEventListener("dragenter", onEnter)
      document.removeEventListener("dragend", onEnd)
      document.removeEventListener("drop", onDrop)
    }
  }, [onIntent, layout.open])
  // A root's drag, from the board or the sidebar (ADR-0122).
  useRootDrag(onIntent, workflow?.archive.id ?? null)
  /** A task's drag from the sidebar: its id and state. */
  const dragOf = (task: TaskId): RootDrag => ({
    task,
    state: stateOf.get(task) ?? null,
  })
  const openAt = (entry: EntryId) => onIntent({ kind: "openAt", entry })
  /** Show `entry`, in `task`; nothing for none. */
  const openIn = (entry: EntryId, task: TaskId | null) => {
    if (task !== null) onIntent({ kind: "openIn", entry, task })
  }
  // The card's id is the DOM's (`data-card`): read at the edge.
  const dragColumn = useColumnDrag(stripEl, (id, to) => {
    const card = parseCardId(id)
    if (card !== undefined)
      onIntent({ kind: "moveColumn", column: { kind: "card", card }, to })
  })

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
    activity,
    asks,
    folds,
    stops,
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
    rows,
    seats,
    session,
    takeFocus,
    traces,
    work: workFacts,
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

  const { workspace } = view
  const readers = { session, index, taskOfThread, order, nameOf, colorOf }
  const pip = <CardPip color={colorOf(session.writer)} />
  const thread = threadRow({ index, labelOf, onOpen: openIn })
  return (
    <Pictures value={pictures}>
      <CardHistories value={historyFacts}>
        {listView !== null && workspace.kind !== "connecting" ? (
          <Sidebar
            colorOf={colorOf}
            dragOf={dragOf}
            index={index}
            nameOf={nameOf}
            onIntent={onIntent}
            order={order}
            session={session}
            taskOfThread={taskOfThread}
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
            reader={{ me: session.writer, nameOf }}
            notices={moves.notices.filter(r => r.actedAt.kind === "inventory")}
            selected={selected}
            session={session}
            slots={slots}
          />
        )}
        {/* Under a page the workspace stays mounted and laid out, only inert
          (ADR-0098). Remounted, its columns would lose their scroll; with
          `display: none`, `useStripNarrow` would measure the strip at 0 and
          turn an open pane into a modal dialog over the page. */}
        <main
          aria-hidden={page !== null || undefined}
          id="workspace"
          inert={page !== null}
        >
          {/* What the workspace's columns draw by (ADR-0087, ADR-0089): the
            root's colours, whether the pane covers the page, how you read a
            review. Each changes rarely, and only its readers redraw. */}
          <TrackSeed value={seed}>
            <ThreadStates value={workflow?.open ?? NO_STATES}>
              <NarrowContext value={narrow}>
                <ReviewPrefsContext value={reviewReach}>
                  {listView === null || workspace.kind === "connecting" ? (
                    <p className="connecting">connecting…</p>
                  ) : workspace.kind === "nothing" ? (
                    <p className="nothing-here">
                      Open a thread from the board, or start one with ＋.
                    </p>
                  ) : (
                    <>
                      {workspace.kind === "task" ? (
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
                          rows={rail}
                          session={session}
                          viewports={viewports}
                          yours={yours}
                        />
                      ) : (
                        <EmptyRail />
                      )}
                      <Strip
                        canvas={canvas}
                        names={workFacts.names}
                        noteViews={noteViews}
                        onIntent={onIntent}
                        onPointerDown={dragColumn}
                        projected={projected}
                        reader={historyFacts.reader}
                        readers={readers}
                        shared={{
                          ...shared,
                          landmarks,
                          seenEnd: seenEnds,
                          forks: colors.forks,
                          onIntent,
                          shown,
                        }}
                        strip={strip}
                        stripRef={stripEl}
                        taskColumn={taskColumn}
                        taskPins={taskPins}
                        taskPinsInView={taskPinsInView}
                        told={told}
                        thread={(end, task) => thread(end, end, task)}
                        typing={typing}
                        workspace={workspace}
                      />
                    </>
                  )}
                  {layout.board && boardShown !== null && (
                    <Board
                      onClearFilter={clearBoardFilter}
                      onIntent={onIntent}
                      pip={pip}
                      readers={readers}
                      searchRef={boardSearchField}
                      thread={(end, task) => thread(end, end, task)}
                      view={boardShown}
                    />
                  )}
                </ReviewPrefsContext>
              </NarrowContext>
            </ThreadStates>
          </TrackSeed>
        </main>
        {page !== null && (
          <Page onBack={() => onIntent({ kind: "page", to: null })} page={page}>
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
              takeFocus={() => takeFocus(BOARD_SEARCH)}
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
            taskOfThread,
            labelOf,
            nameOf,
            onOpen: openIn,
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
  )
}
