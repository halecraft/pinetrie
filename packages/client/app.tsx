// client/app — the page: `App`, which `main.tsx` mounts.
//
// The screen is your list down the left, the root you are on beside it, a
// rail beside a strip of columns, and the footer along the bottom: you, the
// board's strip, what needs you and the project (docs/06-interface.md,
// ADR-0085). The rail draws the root's tree; each column is one path, read on
// its own scroll; the board opens over them. What is drawn is a read of the
// document, through `@pinetrie/reads` and `projection.ts`. Your list is your
// own document, on every device (`openList`). Which root you are on, each
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
  type ArchivedRoot,
  branchColors,
  type CardId,
  cardId,
  type EntryId,
  pathIds,
  projectColumns,
  type RootId,
  rootWork,
  type WorkflowStateId,
} from "@pinetrie/core"
import {
  participantsIn,
  readHeldIndex,
  readParticipantNames,
  readRoots,
} from "@pinetrie/reads"
import { boardOf } from "@pinetrie/rules"
import {
  heldBy,
  intentsOf,
  newRootId,
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
import { placement } from "./align.ts"
import { appView, hereRail, laneRootsOf } from "./app-view.ts"
import { foldMemory } from "./ask-fold.ts"
import { needsYouCount } from "./attention.ts"
import { Board, BoardStrip } from "./board.tsx"
import { boardView } from "./board-view.ts"
import { CardHistories } from "./card-history.tsx"
import { cardMarks, ownCards } from "./card-marks.ts"
import { CardPip } from "./card-pip.tsx"
import { Column } from "./column.tsx"
import { type Column as ColumnSpec, isAnchored } from "./columns.ts"
import type { SeenEnd } from "./follow.ts"
import { Footer, threadRow } from "./footer.tsx"
import { planHeldRoots, rootEntriesOf } from "./held-roots.ts"
import { runsHere } from "./here.ts"
import { type Identity, reconcileName } from "./identity.ts"
import { mentionsOf } from "./inbox.ts"
import {
  claimFocus,
  type Effect,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
import type { Dock } from "./inventory-dock.ts"
import { keyAct } from "./inventory-keys.ts"
import { InventoryPanel } from "./inventory-panel.tsx"
import {
  columnsOf,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import { OpenList } from "./open-list.tsx"
import { offeredByRoot, openListView, pageTitle } from "./open-list-view.ts"
import { type AppPorts, perform } from "./perform.ts"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { planReading, type TypedLast, typingDue } from "./presence-report.ts"
import { type HeldView, readHeldLanes, readSessionFacts } from "./projection.ts"
import {
  CARD_MIME,
  composerPlacesStore,
  DROP_ZONE,
  targetOfElement,
} from "./put-target.ts"
import { EmptyRail, LiveRail } from "./rail.tsx"
import { columnLandmarks } from "./rail-view.ts"
import {
  firstLinesOf,
  labelsOf,
  messageCount,
  NO_TEXT,
  summariesOf,
} from "./root-label.ts"
import type { RootDrag } from "./root-target.ts"
import { screenMemory } from "./screen-memory.ts"
import type { DeviceState, TabState } from "./tab-state.ts"
import type { RowMemory } from "./tool-row.ts"
import { useAttention } from "./use-attention.ts"
import { useColumnDrag } from "./use-column-drag.ts"
import { useFilledCards } from "./use-filled-cards.ts"
import { FLIGHT_MS, useFlight } from "./use-flight.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { useReveal } from "./use-reveal.ts"
import { useRootDrag } from "./use-root-drag.ts"
import { useStable } from "./use-stable.ts"
import {
  placeAt,
  type Spot,
  spotFor,
  spotStore,
  viewportStore,
} from "./viewport.ts"

/** What `App` keeps on this device and tab, built by `main.tsx`. */
export interface AppStores {
  readonly layout: TabState<Layout>
  readonly identity: DeviceState<Identity>
  /** Where the inventory panel is docked, on this device (ADR-0048). */
  readonly dock: DeviceState<Dock>
}

/** How long a card's drag held over a root in your list opens it. */
const ITEM_HOVER_MS = 600

const cardOrNull = (id: string | undefined): CardId | null =>
  id === undefined || id === "" ? null : cardId(id)

/** Whether `el` is a text box, whose undo keys are its own. */
const isTextBox = (el: Element | null): boolean =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement

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

export function App({
  session,
  stores,
}: {
  session: SessionClient
  stores: AppStores
}) {
  const doc = session.session
  const status = useDocStatus(doc)
  // The roots this tab holds (ADR-0063): the roots of your list and the one
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
  // The directory of every root (ADR-0063): what your list, the board and
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
  // change to the session, as a run's start or end is one, and to the cards.
  const lanes = useSelector(
    heldView,
    useCallback(
      (v: HeldView) => readHeldLanes(v, readHeldIndex(v.roots), cards),
      [cards],
    ),
  )
  // Its own read, not part of the facts: every message compares `nameOf` by
  // identity, so it may change only when a name does.
  const nameOf = useSelector(doc, readParticipantNames)

  // Each root, for the board and its label: its title, else its first line
  // (ADR-0045). Which roots are in your list is yours (`openList`, ADR-0085).
  const summaries = useMemo(() => summariesOf(directory), [directory])
  const lines = useMemo(() => firstLinesOf(directory), [directory])
  const labels = useMemo(
    () => labelsOf(directory, workFacts.lanes),
    [directory, workFacts.lanes],
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
  // The agent's runs and each lane's root, in every root, held or not
  // (ADR-0063): what the header lists.
  const rootEntries = useMemo(() => rootEntriesOf(directory), [directory])
  const rootIds = useMemo(
    () => new Map([...rootEntries].map(([id, entry]) => [entry, id] as const)),
    [rootEntries],
  )
  // The roots in the closed state (ADR-0085), by root entry: the layout, the
  // marks and attention are keyed by it.
  const archivedEntries = useMemo(() => {
    const out = new Map<EntryId, ArchivedRoot>()
    for (const [id, a] of archived) {
      const entry = rootEntries.get(id)
      if (entry !== undefined) out.set(entry, a)
    }
    return out
  }, [archived, rootEntries])
  const archivedRoots = useMemo(
    () => new Set(archivedEntries.keys()),
    [archivedEntries],
  )
  // Your list (ADR-0085): your own document, by root entry; a root the
  // directory does not name yet is left out until it does.
  const listIds = useSyncExternalStore(
    session.openList.roots.subscribe,
    session.openList.roots.current,
  )
  const list = useMemo(
    () =>
      listIds.flatMap(id => {
        const entry = rootEntries.get(id)
        return entry === undefined ? [] : [entry]
      }),
    [listIds, rootEntries],
  )
  // The board (ADR-0085): each root's state, by root entry.
  const board = useMemo(
    () =>
      workflow === null ? null : boardOf(workflow, places, rootEntries.keys()),
    [workflow, places, rootEntries],
  )
  const stateOf = useMemo(() => {
    const out = new Map<EntryId, WorkflowStateId>()
    for (const [id, state] of board?.stateOf ?? []) {
      const entry = rootEntries.get(id)
      if (entry !== undefined) out.set(entry, state)
    }
    return out
  }, [board, rootEntries])
  const runs = useMemo(
    () => runsHere({ activity, running, rootEntries, index }),
    [activity, running, rootEntries, index],
  )
  const laneRoots = useMemo(
    () => laneRootsOf(workFacts.lanes, rootEntries),
    [workFacts.lanes, rootEntries],
  )
  const work = useMemo(() => rootWork(index, lanes), [index, lanes])
  // A root with no message has no summary, so it has no label in `labels`.
  const labelOf = (root: EntryId): string => labels.get(root) ?? NO_TEXT

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
      resolveLayout(stored, { index, lanes, archived: archivedRoots, list }),
    [stored, index, lanes, archivedRoots, list],
  )
  useEffect(() => {
    if (layout !== stored)
      dispatch({ kind: "resolve", index, lanes, archived: archivedRoots, list })
  }, [layout, stored, index, lanes, archivedRoots, list])
  // Every change is saved, the document's too: restored from an older
  // anchor, `followTip` could land on a newer branch below it.
  useEffect(() => stores.layout.save(layout), [stores, layout])
  // Restored anchors the document lacks are dropped once, when it has
  // settled, and the tab to show is chosen then: before, missing means not
  // yet arrived. `"populated"` comes with the first data, so it cannot tell
  // (S29).
  // The roots your list and the stored root you were on name are held, and
  // settled, first: their anchors are in no index before (ADR-0063).
  const [settled, setSettled] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the stored layout of that render
  useEffect(() => {
    let alive = true
    void whenSettled(doc).then(async () => {
      const known = rootEntriesOf(readRoots(doc))
      session.holdRoots(
        planHeldRoots({
          layout: {
            active: stored.active,
            open: session.openList.roots
              .current()
              .flatMap(id => known.get(id) ?? []),
          },
          directory: readRoots(doc),
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
  // What this tab holds follows your list, once the stored roots are settled.
  useEffect(() => {
    if (settled) session.holdRoots(planHeldRoots({ layout, directory }))
  }, [settled, session, layout, directory])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled)
      dispatch({
        kind: "prune",
        index,
        lanes,
        archived: archivedRoots,
        list,
        known: new Set(labels.keys()),
      })
  }, [settled])

  const active = layout.active
  // The tab's columns: a root's, or a new tab's one fresh column.
  // Memoised: `columnsOf` gives a root with no stored columns a new list on
  // each call, and every projection below is keyed on this one.
  const columns: readonly ColumnSpec[] = useMemo(
    () =>
      active === null
        ? []
        : active.kind === "root"
          ? columnsOf(layout, active.root)
          : active.kind === "new"
            ? layout.newTabs.filter(c => c.key === active.key)
            : [],
    [layout, active],
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
        columns.map(c => ({ anchor: c.anchor, anchored: isAnchored(c) })),
      ),
    [index, columns],
  )
  const rail = useMemo(() => hereRail(index, active), [index, active])
  // The root you are on, which your list's repair keeps while it is archived.
  const hereId =
    active?.kind === "root" ? (rootIds.get(active.root) ?? null) : null
  useEffect(() => session.openList.here(hereId), [session, hereId])
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
        archived: archivedRoots,
        lanes,
        index,
        rootEntries,
      }),
    [mine, filled, layout, archivedRoots, lanes, index, rootEntries],
  )
  const yours = useMemo(
    () => ({ ends: unsent.ends, color: colorOf(session.writer) }),
    [unsent.ends, colorOf, session.writer],
  )
  // Each column's end, for the rail: one array while the views are the same.
  const ends = useMemo(() => views.map(v => v.tipId), [views])
  // What no fold hides in this tab's columns: the rail's landmarks (ADR-0056).
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
  // Each column of the root you are on reports its thread end (ADR-0024,
  // ADR-0029; `planReading`), and its root, so a window that does not hold
  // that root can name it (ADR-0063). While the page is visible the entries
  // are refreshed, so they outlive their decay.
  const reported = useRef(new Map<string, string | null>())
  const reportedRoot = useRef<EntryId | null>(null)
  const readingRoot = active?.kind === "root" ? active.root : null
  useEffect(() => {
    const now = new Map(
      columns.map((c, i) => [c.key, views[i]?.tipId ?? null] as const),
    )
    const writes = planReading(reported.current, now)
    for (const [key, end] of writes.set)
      session.setReading(key, end, readingRoot)
    for (const key of writes.clear) session.clearReading(key)
    reported.current = now
    reportedRoot.current = readingRoot
  }, [columns, views, session, readingRoot])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      for (const [key, end] of reported.current)
        if (end !== null) session.setReading(key, end, reportedRoot.current)
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
        archived: archivedEntries,
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
      archivedEntries,
      workflow,
      nameOf,
      workFacts.offers,
      lanes,
      laneRoots,
    ],
  )
  const offered = useMemo(
    () => offeredByRoot(view.offers, workFacts.names),
    [view.offers, workFacts.names],
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
  // What needs you, and where (ADR-0077): each root's status, the activity
  // menu's rows, and the page's title.
  const attention = useAttention({
    me: session.writer,
    attention: session.attention,
    directory,
    verdicts,
    offers: view.offers,
    running,
    lanes,
    laneRoots,
    archived: archivedRoots,
    work,
    layout,
    settled,
  })
  const needsYou = needsYouCount(attention.items) + inbox.unseen
  const listView =
    active === null
      ? null
      : openListView({
          layout,
          active,
          labels,
          lines,
          marks,
          archived: archivedRoots,
          work,
          offered,
          unsent,
          status: attention.status,
          arrivals: attention.arrivals,
          workflow,
          stateOf,
          rootIds,
        })
  const title = pageTitle(needsYou, listView?.selected ?? null)
  // The closed state's search and "mine": never stored.
  const [boardQuery, setBoardQuery] = useState("")
  const [boardMine, setBoardMine] = useState(false)
  const boardShown = useMemo(
    () =>
      workflow === null
        ? null
        : boardView({
            workflow,
            places,
            rootEntries,
            summaries,
            labels,
            status: attention.status,
            cardRoots: unsent.roots,
            query: boardQuery,
            mine: boardMine,
            me: session.writer,
            work,
          }),
    [
      workflow,
      places,
      rootEntries,
      summaries,
      labels,
      attention.status,
      unsent.roots,
      boardQuery,
      boardMine,
      session.writer,
      work,
    ],
  )
  useEffect(() => {
    document.title = title
  }, [title])

  const strip = useRef<HTMLDivElement>(null)

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
    const el = strip.current
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
  // its rows as they were left (ADR-0049). Never pruned: a call id is not
  // reused.
  const [rows] = useState(() => screenMemory<RowMemory>())
  // Each ask's fold as its reader chose it (ADR-0056), kept as rows are.
  const [folds] = useState(() => foldMemory())

  // After the alignment above: a picked message the alignment left out of
  // view is scrolled to.
  const reveal = useReveal(strip)

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
            slots,
            selected,
            composers: composers.current(),
          },
          rootEntries,
          rootIds,
        },
        crypto.randomUUID(),
        newRootId(),
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
        selected,
        selectedCard: slots[String(selected)] ?? null,
        column: lastColumn.current,
      })
      if (intent === null) return
      e.preventDefault()
      onIntent(intent)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onIntent, selected, slots])
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
  // your list, the drag opens it. A root's drag is not a card's: it is
  // `ROOT_MIME`, and lands by `useRootDrag`.
  useEffect(() => {
    let hover: {
      readonly root: EntryId
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
          ? e.target.closest<HTMLElement>(".open-root[data-root]")?.dataset.root
          : undefined
      // The item's root, as your list holds it.
      const root = layout.open.find(r => r === item)
      if (root !== hover?.root) {
        if (hover !== null) clearTimeout(hover.timer)
        hover =
          root === undefined
            ? null
            : {
                root,
                timer: setTimeout(
                  () =>
                    onIntent({
                      kind: "show",
                      here: { kind: "root", root },
                    }),
                  ITEM_HOVER_MS,
                ),
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
      const card = e.dataTransfer?.getData(CARD_MIME) ?? ""
      if (target === null || card === "") return
      e.preventDefault()
      onIntent({ kind: "put", card: cardId(card), target })
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
  // A root's drag, from the board or your list (ADR-0085).
  useRootDrag(onIntent, workflow?.closed.id ?? null)
  /** A root's drag from your list: its id and state, or null with no id yet. */
  const dragOf = (root: string): RootDrag | null => {
    const entry = root as EntryId
    const id: RootId | undefined = rootIds.get(entry)
    return id === undefined
      ? null
      : { root: id, entry, state: stateOf.get(entry) ?? null }
  }
  const openAt = (entry: EntryId) => onIntent({ kind: "openAt", entry })
  const openIn = (entry: EntryId, root: EntryId) =>
    onIntent({ kind: "openIn", entry, root })
  const dragColumn = useColumnDrag(strip, (from, to) =>
    onIntent({
      kind: "column",
      position: from,
      key: columns[from]?.key ?? "",
      act: { kind: "move", to },
    }),
  )

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
  const readers = { session, index, order, nameOf, colorOf }
  const pip = <CardPip color={colorOf(session.writer)} />
  const thread = threadRow({ index, labelOf, onOpen: openIn })
  return (
    <CardHistories value={historyFacts}>
      {listView !== null && workspace.kind !== "connecting" ? (
        <OpenList
          colorOf={colorOf}
          dragOf={dragOf}
          index={index}
          nameOf={nameOf}
          onIntent={onIntent}
          order={order}
          session={session}
          view={listView}
        />
      ) : (
        <nav aria-label="your threads" id="open-list" />
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
          refusals={moves.refusals.filter(r => r.actedAt.kind === "inventory")}
          selected={selected}
          session={session}
          slots={slots}
        />
      )}
      <main id="workspace">
        {listView === null || workspace.kind === "connecting" ? (
          <p className="connecting">connecting…</p>
        ) : workspace.kind === "nothing" ? (
          <p className="nothing-here">
            Open a thread from the board, or start one with ＋.
          </p>
        ) : (
          <>
            {workspace.kind === "root" ? (
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
            {/* A column's header is its drag handle; its grip is the
                  keyboard's way to move it. */}
            <div id="strip" onPointerDown={dragColumn} ref={strip}>
              {workspace.slots.map(slot => {
                const column = columns[slot.position]
                const columnView = views[slot.position]
                if (column === undefined || columnView === undefined)
                  return null
                return (
                  <Column
                    {...shared}
                    closable={slot.closable}
                    column={column}
                    count={workspace.slots.length}
                    landmarks={landmarks}
                    seenEnd={seenEnds}
                    forks={colors.forks}
                    key={slot.key}
                    onIntent={onIntent}
                    onTyping={card => typing(columnView.tipId, card)}
                    path={paths[slot.position] ?? new Set()}
                    position={slot.position}
                    readOnly={
                      workspace.kind === "root" ? workspace.readOnly : null
                    }
                    shown={shown}
                    track={slot.track}
                    view={columnView}
                  />
                )
              })}
            </div>
          </>
        )}
        {layout.board && boardShown !== null && (
          <Board
            mine={boardMine}
            onIntent={onIntent}
            onMine={setBoardMine}
            onQuery={setBoardQuery}
            pip={pip}
            query={boardQuery}
            readers={readers}
            thread={(end, root) => thread(end, end, root)}
            view={boardShown}
          />
        )}
      </main>
      <Footer
        syncing={status === "pending"}
        strip={
          <BoardStrip
            count={count}
            elsewhere={attention.elsewhere}
            onIntent={onIntent}
            open={layout.board}
            pip={unsent.elsewhere ? pip : null}
            readers={readers}
            view={boardShown}
          />
        }
        colorOf={colorOf}
        inbox={inbox}
        index={index}
        labelOf={labelOf}
        mentions={mentions}
        nameOf={nameOf}
        names={workFacts.names}
        line={workFacts.line}
        project={workFacts.project}
        onIntent={onIntent}
        offers={view.offers}
        attention={attention.items}
        me={{
          writer: session.writer,
          email: session.principal,
          rename: name => session.request({ kind: "name", name }),
          signOut: () => onIntent({ kind: "signOut" }),
        }}
        onOpen={openIn}
        session={session}
        runs={runs}
        inventory={{
          open: inventoryOpen,
          count: held.length,
          onToggle: () => setInventoryOpen(open => !open),
        }}
      />
    </CardHistories>
  )
}
