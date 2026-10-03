// client/app — the page: `App`, which `main.tsx` mounts.
//
// The screen is your tabs, one per root you opened, each a rail beside a strip
// of columns, under a header showing who is here, your inbox of mentions and
// you (docs/06-interface.md, ADR-0029, ADR-0030). The rail draws the root's tree;
// each column is one path, read on its own scroll. What is drawn is a read of
// the document, through `@pineta/reads` and `projection.ts`. Which tab you are
// on, your tabs and each root's columns are this window's own view state: a
// reducer (`layout.ts`), kept in this browser tab's storage and never in the
// document (ADR-0027). Which mentions you have seen is kept per device.
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
  branchColors,
  type CardId,
  cardId,
  type EntryId,
  PENDING_TRACK,
  pathIds,
  projectColumns,
  projectRail,
  rootWork,
} from "@pineta/core"
import {
  participantsIn,
  readHeldIndex,
  readParticipantNames,
  readRoots,
} from "@pineta/reads"
import {
  type ComponentProps,
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
import {
  appView,
  laneRootsOf,
  type ReadOnly,
  readOnlyWords,
  tabRail,
} from "./app-view.ts"
import { ArchiveTab } from "./archive.tsx"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"
import { foldMemory } from "./ask-fold.ts"
import { cardMarks, ownCards } from "./card-marks.ts"
import { intentsOf } from "./card-moves.ts"
import { INVENTORY } from "./card-words.ts"
import { Column, type ColumnProps } from "./column.tsx"
import { type Column as ColumnSpec, isPinned } from "./columns.ts"
import type { SeenEnd } from "./follow.ts"
import { Header } from "./header.tsx"
import { planHeldRoots, rootEntriesOf } from "./held-roots.ts"
import { runsHere } from "./here.ts"
import { type Identity, reconcileName } from "./identity.ts"
import { newRootId } from "./ids.ts"
import { type Inbox, mentionsOf } from "./inbox.ts"
import {
  claimFocus,
  type Effect,
  entryShown,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
import { heldBy, settleSlots } from "./inventory.ts"
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
import type { Left } from "./left.ts"
import { type AppPorts, perform } from "./perform.ts"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { planReading, typingDue } from "./presence-report.ts"
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
  messageCountTitle,
  NO_TEXT,
  summariesOf,
} from "./root-label.ts"
import { screenMemory } from "./screen-memory.ts"
import type { SessionClient } from "./session-view.ts"
import type { DeviceState, TabState } from "./tab-state.ts"
import { TabBar } from "./tabs.tsx"
import { offeredByRoot, tabsView } from "./tabs-view.ts"
import type { RowMemory } from "./tool-row.ts"
import { useColumnDrag } from "./use-column-drag.ts"
import { useFilledCards } from "./use-filled-cards.ts"
import { FLIGHT_MS, useFlight } from "./use-flight.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { useReveal } from "./use-reveal.ts"
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
  readonly inbox: DeviceState<Inbox>
  /** Where this device last left each thread (ADR-0056). */
  readonly left: DeviceState<Left>
  readonly identity: DeviceState<Identity>
  /** Where the inventory panel is docked, on this device (ADR-0048). */
  readonly dock: DeviceState<Dock>
}

/** How long a card's drag held over a root's tab opens it. */
const TAB_HOVER_MS = 600

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
  // The roots this tab holds (ADR-0063): the roots of your open tabs, the one
  // you are on and the Archive tab's preview, set by the effect below. Every
  // read of the tree reads them as one.
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
  // The directory of every root (ADR-0063): what the tabs, the Archive tab
  // and the inbox read of a root without holding it.
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
    archive,
    marks,
    workFacts,
    asks,
    stops,
    digests,
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

  // Each root, for the Archive tab and its label: its title, else its first
  // line (ADR-0045). Which roots have tabs is yours (`layout.open`, ADR-0030).
  const summaries = useMemo(() => summariesOf(directory), [directory])
  const lines = useMemo(() => firstLinesOf(directory), [directory])
  const labels = useMemo(() => labelsOf(directory), [directory])
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
    () => resolveLayout(stored, { index, lanes, archive }),
    [stored, index, lanes, archive],
  )
  useEffect(() => {
    if (layout !== stored) dispatch({ kind: "resolve", index, lanes, archive })
  }, [layout, stored, index, lanes, archive])
  // Every change is saved, the document's too: restored from an older
  // anchor, `followTip` could land on a newer branch below it.
  useEffect(() => stores.layout.save(layout), [stores, layout])
  // Restored anchors the document lacks are dropped once, when it has
  // settled, and the tab to show is chosen then: before, missing means not
  // yet arrived. `"populated"` comes with the first data, so it cannot tell
  // (S29).
  // The roots your stored tabs name are held, and settled, first: their
  // anchors are in no index before (ADR-0063).
  const [settled, setSettled] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the stored layout of that render
  useEffect(() => {
    let alive = true
    void whenSettled(doc).then(async () => {
      session.holdRoots(
        planHeldRoots({
          layout: stored,
          preview: null,
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
  // The Archive tab's pick: its preview is a root this tab holds.
  const [archivePick, setArchivePick] = useState<EntryId | null>(null)
  // What this tab holds follows your tabs, once the stored ones are settled.
  useEffect(() => {
    if (settled)
      session.holdRoots(
        planHeldRoots({ layout, preview: archivePick, directory }),
      )
  }, [settled, session, layout, archivePick, directory])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled)
      dispatch({ kind: "prune", index, archive, known: new Set(labels.keys()) })
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
        columns.map(c => ({ anchor: c.anchor, pinned: isPinned(c) })),
      ),
    [index, columns],
  )
  const rail = useMemo(() => tabRail(index, active), [index, active])
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
  const archivedRoots = useMemo(
    () =>
      new Set(
        [...archive.values()].flatMap(r =>
          r.state === "archived" ? [r.root] : [],
        ),
      ),
    [archive],
  )
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
  // Each column of the tab you are on reports its thread end (ADR-0024,
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
  const lastTyped = useRef(0)
  const typing = (end: string | null) => {
    const now = Date.now()
    if (end === null || !typingDue(lastTyped.current, now)) return
    lastTyped.current = now
    session.setTyping(end)
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
        archive,
        nameOf,
        offers: workFacts.offers,
        lanes,
        laneRoots,
      }),
    [
      active,
      columns,
      colors.track,
      archive,
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
    store: stores.inbox,
    roots: directory.values(),
    items: mentions,
    shown,
    settled,
  })

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

  // The Archive tab's own state: never stored.
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all")
  const [archiveQuery, setArchiveQuery] = useState("")

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
    reveal,
    openWhenHeld: setWhenHeld,
    openFold: ask => {
      folds.set(ask, "open")
      setOpened(n => n + 1)
    },
    pickArchived: setArchivePick,
    arm: key => {
      armed.current = key
    },
    identity: stores.identity,
    reload: () => location.reload(),
    inventory: {
      // A take while the panel is closed shows it for the card's flight.
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
          archive,
          asks,
          cards: {
            cards,
            lanes,
            me: session.writer,
            slots,
            selected,
            composers: composers.current(),
          },
          rootEntries,
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
  // A card's drag (HTML drag and drop: it crosses elements and tabs). A
  // drop lands only where put can (`targetOfElement`); held over a root's
  // tab, the drag opens it.
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
      const tab =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(".tab[data-root]")?.dataset.root
          : undefined
      // The tab's root, as your layout holds it.
      const root = layout.open.find(r => r === tab)
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
                      tab: { kind: "root", root },
                    }),
                  TAB_HOVER_MS,
                ),
              }
      }
      if (targetOf(e) !== null) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const target = targetOf(e)
      const card = e.dataTransfer?.getData(CARD_MIME) ?? ""
      if (target === null || card === "") return
      e.preventDefault()
      onIntent({ kind: "put", card: cardId(card), target })
    }
    document.addEventListener("dragover", onOver)
    document.addEventListener("drop", onDrop)
    return () => {
      if (hover !== null) clearTimeout(hover.timer)
      document.removeEventListener("dragover", onOver)
      document.removeEventListener("drop", onDrop)
    }
  }, [onIntent, layout.open])
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
    left: stores.left,
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
    work: workFacts,
  }

  /** A root, read-only, for the Archive tab: its rail and one column. */
  const preview = (r: EntryId) => (
    <Preview
      key={r}
      onIntent={onIntent}
      readOnly={readOnlyWords(r, archive.get(r), nameOf)}
      root={r}
      shared={shared}
      yours={yours}
    />
  )

  const { workspace } = view
  return (
    <>
      <header id="top">
        <div className="header-left">
          <h1>pineta</h1>
          <div className="meta">
            <span title={messageCountTitle(count)}>
              messages <span id="held">{count.held}</span> of{" "}
              <span id="count">{count.total}</span>
            </span>{" "}
            ·{" "}
            <span id="status">
              {status === "pending" ? "syncing…" : "connected"}
            </span>
          </div>
        </div>
        <Header
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
          me={{
            writer: session.writer,
            email: session.principal,
            rename: session.setName,
            signOut: () => onIntent({ kind: "signOut" }),
          }}
          onOpen={openIn}
          order={order}
          session={session}
          runs={runs}
        />
        <button
          aria-pressed={inventoryOpen}
          className="inventory-toggle"
          onClick={() => setInventoryOpen(open => !open)}
          title="your inventory: cards you keep for later"
          type="button"
        >
          {INVENTORY} {held.length}
        </button>
      </header>
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
      {active === null || workspace.kind === "connecting" ? (
        <main id="workspace">
          <p className="connecting">connecting…</p>
        </main>
      ) : (
        <>
          <TabBar
            colorOf={colorOf}
            index={index}
            nameOf={nameOf}
            onIntent={onIntent}
            order={order}
            session={session}
            view={tabsView({
              layout,
              active,
              labels,
              lines,
              marks,
              archived: archivedRoots,
              work,
              offered,
              unsent,
            })}
          />
          <main id="workspace">
            {workspace.kind === "archive" ? (
              <ArchiveTab
                filter={archiveFilter}
                labelOf={labelOf}
                myColor={yours.color}
                nameOf={nameOf}
                onFilter={setArchiveFilter}
                onQuery={setArchiveQuery}
                onSelect={setArchivePick}
                preview={preview}
                query={archiveQuery}
                rows={archiveIndex({
                  roots: summaries,
                  labels,
                  archive,
                  filter: archiveFilter,
                  query: archiveQuery,
                  me: session.writer,
                  cardRoots: unsent.roots,
                })}
                selected={archivePick}
              />
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
                        onTyping={() => typing(columnView.tipId)}
                        path={paths[slot.position] ?? new Set()}
                        position={slot.position}
                        readOnly={
                          workspace.kind === "root" ? workspace.readOnly : null
                        }
                        shown={shown}
                        track={slot.track}
                        showsPresence
                        view={columnView}
                      />
                    )
                  })}
                </div>
              </>
            )}
          </main>
        </>
      )}
    </>
  )
}

/**
 * A root, read-only, in the Archive tab: its rail, and one column that a pick
 * on the rail moves. Its anchor is its own state, never stored. A click that
 * shows an entry picks it here; a read-only action (Restore, Open) goes on to
 * `App`; the column offers nothing else.
 */
function Preview({
  root,
  readOnly,
  yours,
  shared,
  onIntent,
}: {
  root: EntryId
  readOnly: ReadOnly
  /** Thread ends holding a card of yours, for the rail's pips. */
  yours: ComponentProps<typeof LiveRail>["yours"]
  shared: Omit<
    ColumnProps,
    | "closable"
    | "column"
    | "count"
    | "forks"
    | "landmarks"
    | "onIntent"
    | "onTyping"
    | "path"
    | "position"
    | "readOnly"
    | "showsPresence"
    | "shown"
    | "track"
    | "view"
  >
  onIntent: (intent: Intent) => void
}) {
  const [anchor, setAnchor] = useState(root)
  const previewStrip = useRef<HTMLDivElement>(null)
  const reveal = useReveal(previewStrip)
  const pick = (id: EntryId) => {
    setAnchor(id)
    reveal(id)
  }
  const onPreviewIntent = useStable((intent: Intent) => {
    const entry = entryShown(intent)
    if (entry !== null) pick(entry)
    else if (intent.kind === "restore" || intent.kind === "show")
      onIntent(intent)
  })
  const { index } = shared
  const column: ColumnSpec = { key: `preview-${root}`, anchor }
  const [view] = projectColumns(index, [{ anchor }])
  const rail = projectRail(index, root)
  const landmarks = columnLandmarks(rail, {
    activity: shared.activity,
    ends: [view?.tipId ?? null],
    cards: yours.ends,
  })
  const path = pathIds(index, view?.tipId ?? null)
  const track = branchColors(rail, view === undefined ? [] : [view]).track[0]
  if (view === undefined) return null
  return (
    <div className="preview">
      <LiveRail
        activity={shared.activity}
        asks={shared.asks}
        digests={shared.digests}
        revisions={shared.work.revisions}
        colorOf={shared.colorOf}
        ends={[view.tipId]}
        index={index}
        names={shared.nameOf}
        onPick={pick}
        open={path}
        rows={rail}
        session={shared.session}
        viewports={shared.viewports}
        yours={yours}
      />
      <div className="preview-strip" ref={previewStrip}>
        <Column
          {...shared}
          closable={false}
          column={column}
          count={1}
          forks={new Map()}
          landmarks={landmarks}
          onIntent={onPreviewIntent}
          onTyping={() => {}}
          path={path}
          position={0}
          readOnly={readOnly}
          showsPresence={false}
          shown={path}
          // A glance: where it is left is not where the root's tab was.
          spots={undefined}
          track={track ?? PENDING_TRACK}
          view={view}
        />
      </div>
    </div>
  )
}
