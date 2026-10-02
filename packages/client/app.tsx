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
  entryId,
  PENDING_TRACK,
  pathIds,
  projectColumns,
  projectRail,
  rootWork,
  summarizeRoots,
} from "@pineta/core"
import { readCards, readParticipantNames } from "@pineta/reads"
import {
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { placement } from "./align.ts"
import { appView, type ReadOnly, readOnlyWords, tabRail } from "./app-view.ts"
import { ArchiveTab } from "./archive.tsx"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"
import { foldMemory } from "./ask-fold.ts"
import { cardMarks, ownCards } from "./card-marks.ts"
import { Column, type ColumnProps } from "./column.tsx"
import { type Column as ColumnSpec, isPinned } from "./columns.ts"
import type { SeenEnd } from "./follow.ts"
import { Header } from "./header.tsx"
import { type Identity, reconcileName } from "./identity.ts"
import { type Inbox, mentionsOf } from "./inbox.ts"
import {
  claimFocus,
  type Effect,
  entryShown,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
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
import { readSessionFacts } from "./projection.ts"
import { EmptyRail, LiveRail } from "./rail.tsx"
import { columnLandmarks } from "./rail-view.ts"
import { firstLines, NO_TEXT, rootLabels } from "./root-label.ts"
import { screenMemory } from "./screen-memory.ts"
import type { SessionClient } from "./session-view.ts"
import type { DeviceState, TabState } from "./tab-state.ts"
import { TabBar } from "./tabs.tsx"
import { tabsView } from "./tabs-view.ts"
import type { RowMemory } from "./tool-row.ts"
import { useColumnDrag } from "./use-column-drag.ts"
import { useFilledCards } from "./use-filled-cards.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { useReveal } from "./use-reveal.ts"
import { useStable } from "./use-stable.ts"

/** What `App` keeps on this device and tab, built by `main.tsx`. */
export interface AppStores {
  readonly layout: TabState<Layout>
  readonly inbox: DeviceState<Inbox>
  /** Where this device last left each thread (ADR-0056). */
  readonly left: DeviceState<Left>
  readonly identity: DeviceState<Identity>
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
  body.dispatchEvent(new Event(PLACED))
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
  const doc = session.doc
  const status = useDocStatus(doc)
  // Every read is `useSelector` over a named read, never an inline
  // `useTracked` thunk: a new thunk re-runs, so an inline one would read the
  // document again on every render, whatever caused it, and give every value
  // below a new identity.
  const {
    index,
    count,
    activity,
    live,
    lanes,
    outbox,
    participants,
    seats,
    archive,
    marks,
    workFacts,
    asks,
    stops,
    digests,
  } = useSelector(doc, readSessionFacts)
  // Every card's record (ADR-0048): a second document, read on its own. An
  // unchanged card keeps its record object (`readCards`).
  const cards = useSelector(session.cards, readCards)
  // Its own read, not part of the facts: every message compares `nameOf` by
  // identity, so it may change only when a name does.
  const nameOf = useSelector(doc, readParticipantNames)

  // Each root, for the Archive tab and its label: its title, else its first
  // line (ADR-0045). Which roots have tabs is yours (`layout.open`, ADR-0030).
  const summaries = useMemo(() => summarizeRoots(index), [index])
  const lines = useMemo(() => firstLines(summaries, index), [summaries, index])
  const labels = useMemo(() => rootLabels(lines, marks), [lines, marks])
  const work = useMemo(() => rootWork(index, lanes), [index, lanes])
  // A root with no message has no summary, so it has no label in `labels`.
  const labelOf = (root: string): string => labels.get(root) ?? NO_TEXT

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
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let live = true
    void whenSettled(doc).then(() => {
      if (live) setSettled(true)
    })
    return () => {
      live = false
    }
  }, [doc])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at settle, with the index of that render
  useEffect(() => {
    if (settled) dispatch({ kind: "prune", index, archive })
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
          r.state === "archived" ? [r.root as string] : [],
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
      }),
    [mine, filled, layout, archivedRoots, lanes, index],
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
  // ADR-0029; `planReading`). While the page is visible the entries are
  // refreshed, so they outlive their decay.
  const reported = useRef(new Map<string, string | null>())
  useEffect(() => {
    const now = new Map(
      columns.map((c, i) => [c.key, views[i]?.tipId ?? null] as const),
    )
    const writes = planReading(reported.current, now)
    for (const [key, end] of writes.set) session.setReading(key, end)
    for (const key of writes.clear) session.clearReading(key)
    reported.current = now
  }, [columns, views, session])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      for (const [key, end] of reported.current)
        if (end !== null) session.setReading(key, end)
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
      }),
    [active, columns, colors.track, archive, nameOf, workFacts.offers, lanes],
  )

  // Your inbox: the messages that mention you, and which you have seen.
  const mentions = useMemo(
    () =>
      mentionsOf({
        index,
        me: session.writer,
        myName: nameFor(nameOf, session.writer),
        participants,
      }),
    [index, session.writer, nameOf, participants],
  )
  const inbox = useInbox({
    store: stores.inbox,
    index,
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
      alignOnOpen(el, column.key, views[i]?.forkFrom ?? null)
    }
  }, [columns, views])

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
  const [archivePick, setArchivePick] = useState<string | null>(null)

  // An opened fold draws in its own ask (`AskWork`): a render of `App`
  // runs `useReveal`'s wait once it has.
  const [, setOpened] = useState(0)
  const ports: AppPorts = {
    dispatch,
    session,
    reveal,
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
  }
  /** Carry out `effects`: the one way anything below acts. */
  const run = useStable((effects: readonly Effect[]) => perform(effects, ports))
  /** What a reader asked for, planned from this render's layout and facts. */
  const onIntent = useStable((intent: Intent) =>
    run(
      planIntent(intent, { layout, index, archive, asks }, crypto.randomUUID()),
    ),
  )
  const openAt = (entry: string) => onIntent({ kind: "openAt", entry })
  const dragColumn = useColumnDrag(strip, (from, to) =>
    onIntent({ kind: "column", position: from, act: { kind: "move", to } }),
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
    digests,
    colorOf,
    cards,
    index,
    lanes,
    nameOf,
    outbox,
    participants,
    rows,
    seats,
    session,
    takeFocus,
    work: workFacts,
  }

  /** A root, read-only, for the Archive tab: its rail and one column. */
  const preview = (r: string) => (
    <Preview
      key={r}
      onIntent={onIntent}
      readOnly={readOnlyWords(entryId(r), archive.get(r), nameOf)}
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
            entries <span id="count">{count}</span> ·{" "}
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
          offers={view.offers}
          me={{
            writer: session.writer,
            email: session.principal,
            rename: session.setName,
            signOut: () => onIntent({ kind: "signOut" }),
          }}
          onOpen={openAt}
          order={order}
          session={session}
          runs={activity}
        />
      </header>
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
                  index,
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
  root: string
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
  const pick = (id: string) => {
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
          track={track ?? PENDING_TRACK}
          view={view}
        />
      </div>
    </div>
  )
}
