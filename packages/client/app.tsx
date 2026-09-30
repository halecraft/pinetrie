// client/app — browser entry. Vite transforms and serves this directly.
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
// The renderer before React rebuilt the transcript with `innerHTML` on every
// change, which destroyed focus and selection on every keystroke. React gives
// stable node identity, which `useText` needs to keep a note's textarea
// bound while everyone types (ADR-0025).

import { whenSettled } from "@kyneta/exchange"
import { ExchangeProvider, useDocStatus, useSelector } from "@kyneta/react"
import {
  branchColors,
  compactRail,
  entryId,
  PENDING_TRACK,
  pathIds,
  presenceView,
  projectColumns,
  projectRail,
  rootWork,
  summarizeRoots,
} from "@pineta/core"
import { messageNotes } from "@pineta/marginalia"
import { SESSION_DOC_ID } from "@pineta/protocol/messages"
import {
  type NoteFilter,
  notesIndex,
  readCards,
  readParticipantNames,
  readPresence,
} from "@pineta/reads"
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import { placement } from "./align.ts"
import { ArchiveTab } from "./archive.tsx"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"
import { Column, type ColumnProps } from "./column.tsx"
import { type Column as ColumnSpec, isPinned, type Prefill } from "./columns.ts"
import type { ReadOnly } from "./composer.tsx"
import type { SeenEnd } from "./follow.ts"
import { Header } from "./header.tsx"
import { peopleHere, readersByRoot } from "./here.ts"
import {
  IDENTITY_KEY,
  type Identity,
  identityCodec,
  reconcileName,
} from "./identity.ts"
import { askIdentity } from "./identity-form.tsx"
import {
  decodeInbox,
  encodeInbox,
  type Inbox,
  mentionsOf,
  mergeInbox,
} from "./inbox.ts"
import {
  columnsOf,
  decodeLayout,
  encodeLayout,
  initialLayout,
  type LayoutAction,
  layoutReducer,
  planOpen,
  resolveLayout,
  tabBar,
} from "./layout.ts"
import { NotesIndex } from "./note.tsx"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { readSessionFacts } from "./projection.ts"
import { EmptyRail, Rail } from "./rail.tsx"
import { railKeep } from "./rail-view.ts"
import { firstLines, NO_TEXT, rootLabels } from "./root-label.ts"
import { connectSession, type SessionClient } from "./session-view.ts"
import { deviceState, tabState } from "./tab-state.ts"
import { TabBar } from "./tabs.tsx"
import { useColumnDrag } from "./use-column-drag.ts"
import { PLACED } from "./use-follow.ts"
import { useInbox } from "./use-inbox.ts"
import { useReveal } from "./use-reveal.ts"
import { useStable } from "./use-stable.ts"

/**
 * The tab you are on and each root's columns: this browser tab's, or on a new
 * one the device's latest (ADR-0027). The key predates tabs; the layout's
 * version tells an older one apart.
 */
const layoutStore = tabState({
  key: `pineta-columns:${SESSION_DOC_ID}`,
  codec: { encode: encodeLayout, decode: decodeLayout },
  tab: sessionStorage,
  device: localStorage,
})

/**
 * Which mentions of you this device has seen (ADR-0030): shared by its tabs,
 * kept across reloads, never in the document.
 */
const inboxStore = deviceState<Inbox>({
  key: `pineta-inbox:${SESSION_DOC_ID}`,
  codec: { encode: encodeInbox, decode: decodeInbox },
  device: localStorage,
  merge: mergeInbox,
  events: window,
})

/**
 * Who this device says it is (ADR-0037), shared by its tabs. Another tab
 * clearing it, or storing another email, reloads this one too (at mount); a
 * new name for the same email reloads nothing.
 */
const identityStore = deviceState<Identity>({
  key: IDENTITY_KEY,
  codec: identityCodec,
  device: localStorage,
  merge: (_, next) => next,
  events: window,
})

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

function App({ session }: { session: SessionClient }) {
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
    notes,
    seats,
    archive,
    marks,
    workFacts,
  } = useSelector(doc, readSessionFacts)
  // Every card's record (ADR-0048): a second document, read on its own. An
  // unchanged card keeps its record object (`readCards`).
  const cards = useSelector(session.cards, readCards)
  // The note drawn with each message (ADR-0043). A message with one is a
  // square on the rail, and counted on a closed branch's button.
  const notesOf = useMemo(() => messageNotes(notes), [notes])
  const noteEntries = useMemo(() => new Set(notesOf.keys()), [notesOf])
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all")
  // Its own read, not part of the facts: every message compares `nameOf` by
  // identity, so it may change only when a name does.
  const nameOf = useSelector(doc, readParticipantNames)
  const presenceFacts = useSelector(session.presence, readPresence)

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
    () => layoutStore.load() ?? initialLayout(),
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
  useEffect(() => layoutStore.save(layout), [layout])
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
  // This device's name for you and the session's, made to agree once the
  // document has settled: before, a missing name means not yet arrived.
  const myName = nameOf.get(session.writer)
  useEffect(() => {
    if (!settled) return
    const step = reconcileName(identityStore.load(), session.principal, myName)
    if (step?.kind === "send") void session.setName(step.name)
    if (step?.kind === "store") identityStore.save(step.identity)
  }, [settled, myName, session])

  const active = layout.active
  const root = active?.kind === "root" ? active.root : null
  const archivedHere = root === null ? undefined : archive.get(root)
  const readOnly: ReadOnly | null =
    root !== null && archivedHere?.state === "archived"
      ? {
          label: `archived by ${nameFor(nameOf, archivedHere.by)}`,
          action: { title: "Restore", go: () => restore(root) },
        }
      : null
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
  /** A column action on the tab you are on. */
  const act = (
    action: Extract<LayoutAction, { kind: "columns" }>["action"],
  ) => {
    if (active?.kind === "root")
      dispatch({ kind: "columns", root: active.root, action })
    else if (active?.kind === "new" && action.kind === "sent")
      dispatch({ kind: "sent", key: active.key, sendId: action.sendId })
    else if (active?.kind === "new" && action.kind === "close")
      closeNewTab(active.key)
  }
  const closeNewTab = (key: string) => dispatch({ kind: "closeNewTab", key })

  // The column you just opened, whose composer takes focus once when it
  // mounts. Never stored: a column restored, or shown again with its tab,
  // leaves focus where it is.
  const focusNext = useRef<string | null>(null)
  /** A key for a column you open, whose composer then takes focus. */
  const opening = () => {
    const key = crypto.randomUUID()
    focusNext.current = key
    return key
  }
  const takeFocus = (key: string) => {
    if (focusNext.current !== key) return false
    focusNext.current = null
    return true
  }

  const views = useMemo(
    () =>
      projectColumns(
        index,
        columns.map(c => ({ anchor: c.anchor, pinned: isPinned(c) })),
        noteEntries,
      ),
    [index, columns, noteEntries],
  )
  const rail = useMemo(
    () => (root === null ? [] : projectRail(index, root)),
    [index, root],
  )
  const here = useMemo(
    () => presenceView(presenceFacts, session.writer, index),
    [presenceFacts, index, session.writer],
  )
  const order = useMemo(
    () => writerOrder(index, nameOf.keys()),
    [index, nameOf],
  )
  const colorOf = useMemo(() => presenceColors(order), [order])
  // Who else is here, by person, for the header.
  const people = useMemo(
    () => peopleHere(here.readingAt, index, order),
    [here, index, order],
  )
  const readers = useMemo(() => readersByRoot(people), [people])
  const rings = useMemo(
    () =>
      new Map(
        [...here.readingAt].map(([end, writers]) => [
          end,
          writers.map(w => ({
            name: nameFor(nameOf, w),
            color: colorOf(w),
          })),
        ]),
      ),
    [here, nameOf, colorOf],
  )

  // Report the thread end of every column in the tab you are on (ADR-0024,
  // ADR-0029). A key no longer reported is deleted, so switching tabs clears
  // the last tab's columns, as closing a column does. While the page is
  // visible the entries are refreshed, so they outlive their decay. A column
  // with no message yet (a new tab) follows no thread, and reports nothing.
  const reported = useRef(new Map<string, string | null>())
  useEffect(() => {
    const now = new Map(
      columns.map((c, i) => [c.key, views[i]?.tipId ?? null] as const),
    )
    for (const [key, end] of now)
      if (end !== null && reported.current.get(key) !== end)
        session.setReading(key, end)
    for (const key of reported.current.keys())
      if (!now.has(key)) session.clearReading(key)
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
  // Typing is written at most once a second.
  const lastTyped = useRef(0)
  const typing = (end: string | null) => {
    const t = Date.now()
    if (end === null) return
    if (t - lastTyped.current < 1_000) return
    lastTyped.current = t
    session.setTyping(end)
  }
  const colors = useMemo(() => branchColors(rail, views), [rail, views])
  const paths = useMemo(
    () => views.map(v => pathIds(index, v.tipId)),
    [index, views],
  )
  const shown = useMemo(() => new Set(paths.flatMap(p => [...p])), [paths])

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
    store: inboxStore,
    index,
    items: mentions,
    shown,
    settled,
  })
  const railItems = useMemo(
    () =>
      compactRail(
        index,
        rail,
        railKeep({
          notes: noteEntries,
          rings,
          activity,
          ends: views.map(v => v.tipId),
        }),
      ),
    [index, rail, noteEntries, rings, activity, views],
  )

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
  const seenEnds = useRef(new Map<string, SeenEnd>())
  const rememberEnd = useStable((key: string, end: SeenEnd) => {
    seenEnds.current.set(key, end)
  })

  // After the alignment above: a picked message the alignment left out of
  // view is scrolled to.
  const reveal = useReveal(strip)
  const dragColumn = useColumnDrag(strip, (from, to) =>
    act({ kind: "move", from, to }),
  )

  // The Archive tab's own state: never stored.
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all")
  const [archiveQuery, setArchiveQuery] = useState("")
  const [archivePick, setArchivePick] = useState<string | null>(null)

  /**
   * Show entry `id`, wherever it is (`planOpen`): in view in the column that
   * shows it, or in a new one.
   */
  const openAt = (id: string) => {
    const plan = planOpen(layout, index, archive, id)
    if (plan === null) return
    switch (plan.kind) {
      case "scroll":
        reveal(id)
        dispatch({ kind: "show", tab: { kind: "root", root: plan.root } })
        return
      case "open":
        reveal(id)
        dispatch({ kind: "show", tab: { kind: "root", root: plan.root } })
        dispatch({
          kind: "columns",
          root: plan.root,
          action: {
            kind: "open",
            key: crypto.randomUUID(),
            after: plan.after,
            anchor: id,
          },
        })
        return
      case "preview":
        setArchivePick(plan.root)
        dispatch({ kind: "show", tab: { kind: "archive" } })
    }
  }

  const restore = (r: string) =>
    void session.archive("restore", entryId(r)).then(outcome => {
      if (outcome.kind === "restored")
        dispatch({ kind: "show", tab: { kind: "root", root: r } })
    })

  /** The props every column shares, whichever tab draws it. */
  const shared = {
    activity,
    live,
    colorOf,
    cards,
    editorsOf: here.editingAt,
    index,
    lanes,
    nameOf,
    notes,
    notesOf,
    onNewTab: (prefill: Prefill, asksAgent: boolean) =>
      dispatch({ kind: "newTab", key: opening(), asksAgent, prefill }),
    outbox,
    participants,
    seats,
    session,
    takeFocus,
    work: workFacts,
  }

  /** A root, read-only, for the Archive tab: its rail and one column. */
  const preview = (r: string) => {
    const record = archive.get(r)
    return (
      <Preview
        key={r}
        readOnly={
          record?.state === "archived"
            ? {
                label: `archived by ${nameFor(nameOf, record.by)}`,
                action: { title: "Restore", go: () => restore(r) },
              }
            : {
                label: "open",
                action: {
                  title: "Open",
                  go: () =>
                    dispatch({ kind: "show", tab: { kind: "root", root: r } }),
                },
              }
        }
        root={r}
        rings={rings}
        shared={shared}
        noteEntries={noteEntries}
      />
    )
  }

  const newTab = active?.kind === "new" ? active : null
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
          offers={[...workFacts.offers.values()].flatMap(o => {
            const tip = lanes.find(l => l.name === o.lane)?.tip
            return o.taken === null && tip != null
              ? [{ lane: o.lane, tip }]
              : []
          })}
          me={{
            writer: session.writer,
            email: session.principal,
            rename: session.setName,
            signOut: () => {
              identityStore.clear()
              location.reload()
            },
          }}
          onOpen={openAt}
          people={people}
          runs={activity}
        />
      </header>
      {active === null ? (
        <main id="workspace">
          <p className="connecting">connecting…</p>
        </main>
      ) : (
        <>
          <TabBar
            active={active}
            archived={
              new Set(
                [...archive.values()].flatMap(r =>
                  r.state === "archived" ? [r.root as string] : [],
                ),
              )
            }
            colorOf={colorOf}
            labelOf={labelOf}
            nameOf={nameOf}
            lineOf={r => lines.get(r) ?? NO_TEXT}
            titleOf={r => marks.get(r)?.title ?? null}
            onRename={(r, title) => void session.mark(entryId(r), title)}
            newLabel={key =>
              layout.newTabs.find(c => c.key === key)?.asksAgent === true
                ? "new agent"
                : "new conversation"
            }
            onAdd={asksAgent =>
              dispatch({ kind: "newTab", key: opening(), asksAgent })
            }
            onArchive={r => void session.archive("archive", entryId(r))}
            onCloseNew={closeNewTab}
            onCloseRoot={r => dispatch({ kind: "closeRoot", root: r })}
            onShow={tab => dispatch({ kind: "show", tab })}
            readers={readers}
            tabs={tabBar(layout)}
            work={work}
          />
          <main id="workspace">
            {active.kind === "archive" ? (
              <ArchiveTab
                filter={archiveFilter}
                labelOf={labelOf}
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
                  notes,
                  index,
                  filter: archiveFilter,
                  query: archiveQuery,
                  me: session.writer,
                })}
                selected={archivePick}
              />
            ) : (
              <>
                {root !== null && (
                  <Rail
                    activity={activity}
                    here={rings}
                    notes={noteEntries}
                    notesPanel={{
                      count: notesIndex(
                        notes,
                        index,
                        "all",
                        session.writer,
                        root,
                      ).length,
                      open: notesOpen,
                      toggle: () => setNotesOpen(!notesOpen),
                    }}
                    items={railItems}
                    nameOf={w => nameFor(nameOf, w)}
                    onPick={openAt}
                    open={shown}
                  />
                )}
                {newTab !== null && <EmptyRail />}
                {/* Over the columns, beside the rail: inside the rail, whose own
                    scroll clips what overflows it, only a sliver of it showed. */}
                {notesOpen && root !== null && (
                  <NotesIndex
                    filter={noteFilter}
                    nameOf={nameOf}
                    onClose={() => setNotesOpen(false)}
                    onFilter={setNoteFilter}
                    onPick={at => {
                      setNotesOpen(false)
                      openAt(at)
                    }}
                    rows={notesIndex(
                      notes,
                      index,
                      noteFilter,
                      session.writer,
                      root,
                    )}
                    session={session}
                  />
                )}
                {/* A column's header is its drag handle; its grip is the
                    keyboard's way to move it. */}
                <div id="strip" onPointerDown={dragColumn} ref={strip}>
                  {views.map((view, i) => {
                    const column = columns[i]
                    if (column === undefined) return null
                    return (
                      <Column
                        {...shared}
                        // A new tab's column closes the new tab.
                        closable={newTab !== null || columns.length > 1}
                        column={column}
                        count={columns.length}
                        seenEnd={{
                          last: seenEnds.current.get(column.key),
                          remember: rememberEnd,
                        }}
                        forks={colors.forks}
                        key={column.key}
                        onBranch={(at, prefill) =>
                          act({
                            kind: "openFresh",
                            key: opening(),
                            at,
                            after: i,
                            ...(prefill === undefined ? {} : { prefill }),
                          })
                        }
                        onBranchInstead={(at, pending) =>
                          act({
                            kind: "openFresh",
                            key: opening(),
                            at,
                            after: i,
                            pending,
                          })
                        }
                        onClose={() =>
                          newTab !== null
                            ? closeNewTab(newTab.key)
                            : act({ kind: "close", index: i })
                        }
                        onMove={to => act({ kind: "move", from: i, to })}
                        onOpen={openAt}
                        onSent={sendId =>
                          act({ kind: "sent", key: column.key, sendId })
                        }
                        onTyping={() => typing(views[i]?.tipId ?? null)}
                        path={paths[i] ?? new Set()}
                        position={i}
                        readOnly={readOnly}
                        seenBy={
                          view.tipId === null ? [] : here.seenBy(view.tipId)
                        }
                        shown={shown}
                        track={colors.track[i] ?? PENDING_TRACK}
                        typing={
                          view.tipId === null ? [] : here.typingAt(view.tipId)
                        }
                        view={view}
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
 * on the rail moves. Its anchor is its own state, never stored.
 */
function Preview({
  root,
  readOnly,
  rings,
  noteEntries,
  shared,
}: {
  root: string
  readOnly: ReadOnly
  rings: ReadonlyMap<string, readonly { name: string; color: string }[]>
  noteEntries: ReadonlySet<string>
  shared: Omit<
    ColumnProps,
    | "closable"
    | "column"
    | "forks"
    | "onBranch"
    | "onBranchInstead"
    | "onClose"
    | "onMove"
    | "count"
    | "onOpen"
    | "onSent"
    | "onTyping"
    | "path"
    | "position"
    | "readOnly"
    | "seenBy"
    | "shown"
    | "track"
    | "typing"
    | "view"
  >
}) {
  const [anchor, setAnchor] = useState(root)
  const previewStrip = useRef<HTMLDivElement>(null)
  const reveal = useReveal(previewStrip)
  const pick = (id: string) => {
    setAnchor(id)
    reveal(id)
  }
  const { index } = shared
  const column: ColumnSpec = { key: `preview-${root}`, anchor }
  const [view] = projectColumns(index, [{ anchor }], noteEntries)
  const rail = projectRail(index, root)
  const items = compactRail(
    index,
    rail,
    railKeep({
      notes: noteEntries,
      rings,
      activity: shared.activity,
      ends: [view?.tipId ?? null],
    }),
  )
  const path = pathIds(index, view?.tipId ?? null)
  const track = branchColors(rail, view === undefined ? [] : [view]).track[0]
  const none = () => {}
  if (view === undefined) return null
  return (
    <div className="preview">
      <Rail
        activity={shared.activity}
        here={rings}
        items={items}
        nameOf={w => nameFor(shared.nameOf, w)}
        notes={noteEntries}
        onPick={pick}
        open={path}
      />
      <div className="preview-strip" ref={previewStrip}>
        <Column
          {...shared}
          closable={false}
          column={column}
          count={1}
          forks={new Map()}
          onBranch={none}
          onBranchInstead={none}
          onClose={none}
          onMove={none}
          onOpen={pick}
          onSent={none}
          onTyping={none}
          path={path}
          position={0}
          readOnly={readOnly}
          seenBy={[]}
          shown={path}
          track={track ?? PENDING_TRACK}
          typing={[]}
          view={view}
        />
      </div>
    </div>
  )
}

// ── mount ─────────────────────────────────────────────────────────────────
//
// connectSession owns the Exchange, so ExchangeProvider is handed that same
// connection rather than opening a second one. The e2e check drives the exact
// same function in Node.

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
const root = document.getElementById("root")
if (root === null) throw new Error("client/app: missing #root in the page")

// Who you are: your email, asked once per device and shared by its tabs, so a
// reload, another tab and another device with the same email are one person
// (ADR-0037). Kyneta gives each tab its own seat.
const identity =
  identityStore.load() ?? identityStore.save(await askIdentity(root))
identityStore.subscribe(next => {
  if (next?.email !== identity.email) location.reload()
})
const session = await connectSession({
  url: wsUrl,
  WebSocket,
  principal: identity.email,
})
createRoot(root).render(
  <StrictMode>
    <ExchangeProvider exchange={session.exchange}>
      <App session={session} />
    </ExchangeProvider>
  </StrictMode>,
)
