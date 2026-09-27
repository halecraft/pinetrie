// client/app — browser entry. Vite transforms and serves this directly.
//
// The screen is a tab per root, and each root tab is a rail beside a strip of
// columns (docs/06-interface.md, ADR-0029). The rail draws the root's tree;
// each column is one path, read on its own scroll. What is drawn is a read of
// the document, through `@pineta/reads` and `projection.ts`. Which tab you are on and each root's
// columns are this window's own view state: a reducer (`layout.ts`), kept in
// this browser tab's storage and never in the document (ADR-0027).
//
// The renderer before React rebuilt the transcript with `innerHTML` on every
// change, which destroyed focus and selection on every keystroke. React gives
// stable node identity, which `useText` needs to keep a note's textarea
// bound while everyone types (ADR-0025).

import { persistentPeerId, whenSettled } from "@kyneta/exchange"
import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import {
  branchColors,
  entryId,
  messageText,
  openRoots,
  PENDING_TRACK,
  pathIds,
  presenceView,
  projectColumns,
  projectRail,
  rootReaders,
  rootWork,
  summarizeRoots,
} from "@pineta/core"
import { noteEntry } from "@pineta/marginalia"
import { SESSION_DOC_ID } from "@pineta/protocol/messages"
import {
  type NoteFilter,
  notesIndex,
  readAgentActivity,
  readArchive,
  readLanes,
  readNotes,
  readOutbox,
  readParticipantNames,
  readParticipants,
  readPresence,
  readReferences,
  readTreeIndex,
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
import { ArchiveTab } from "./archive.tsx"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"
import { Column, type ColumnProps } from "./column.tsx"
import { type Column as ColumnSpec, isPinned } from "./columns.ts"
import type { ReadOnly } from "./composer.tsx"
import {
  columnsOf,
  decodeLayout,
  encodeLayout,
  initialLayout,
  type LayoutAction,
  layoutReducer,
  planOpen,
  tabBar,
} from "./layout.ts"
import { NotesIndex } from "./note.tsx"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { readEntryCount } from "./projection.ts"
import { Rail } from "./rail.tsx"
import { connectSession, type SessionClient } from "./session-view.ts"
import { tabState } from "./tab-state.ts"
import { TabBar } from "./tabs.tsx"
import { PLACED } from "./use-follow.ts"

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

/** A display name: a label for you, never your identity. */
function NameField({ session }: { session: SessionClient }) {
  const names = useTracked(() => readParticipantNames(session.doc))
  const [draft, setDraft] = useState<string | null>(null)
  const current = names.get(session.writer) ?? ""
  return (
    <input
      id="name"
      onBlur={() => {
        if (draft !== null && draft.trim() !== current)
          void session.setName(draft)
        setDraft(null)
      }}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      placeholder="your name"
      value={draft ?? current}
    />
  )
}

/**
 * Bring a newly opened column's first message level with its fork point in
 * the column that shows it. A column with no fork point opens at its end.
 * Then tell the column it was placed, so it follows its end only if it was
 * placed there (`follow.ts`).
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

/** Scroll the column, or grow its spacer, to meet its fork point. */
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
      ? null
      : [
          ...strip.querySelectorAll<HTMLElement>(
            `.msg[data-entry="${forkFrom}"]`,
          ),
        ].find(el => el.closest(".column") !== column)
  if (
    fork === null ||
    fork === undefined ||
    first === null ||
    spacer === null
  ) {
    body.scrollTop = body.scrollHeight
    return
  }
  spacer.style.height = "0px"
  const want =
    fork.getBoundingClientRect().top - body.getBoundingClientRect().top
  const offset = first.offsetTop - body.offsetTop
  if (offset >= want) body.scrollTop = offset - want
  else {
    spacer.style.height = `${want - offset}px`
    body.scrollTop = 0
  }
}

/** How often a visible page refreshes its presence: well inside its 30 s decay. */
const PRESENCE_REFRESH_MS = 10_000

function App({ session }: { session: SessionClient }) {
  const doc = session.doc
  const status = useDocStatus(doc)
  const count = useTracked(() => readEntryCount(doc))
  // One moment's facts, read together: the same reads the host decides from.
  const { index, activity, lanes, outbox, participants, notes, archive } =
    useTracked(() => {
      const index = readTreeIndex(doc)
      return {
        index,
        activity: readAgentActivity(doc, index),
        lanes: readLanes(doc, index),
        outbox: readOutbox(doc),
        participants: readParticipants(doc, index),
        notes: readNotes(doc),
        archive: readArchive(doc),
      }
    })
  // The messages that are notes' (ADR-0025): a square on the rail, and
  // counted on a closed branch's button.
  const noteEntries = useMemo(
    () =>
      new Set(
        notes.flatMap(n => {
          const e = noteEntry(n, index)
          return e === null ? [] : [e as string]
        }),
      ),
    [notes, index],
  )
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all")
  const refs = useTracked(() => readReferences(doc))
  const nameOf = useTracked(() => readParticipantNames(doc))
  const presenceFacts = useTracked(() => readPresence(session.presence))

  // Each root, and which have tabs: every root not archived (ADR-0029).
  const summaries = useMemo(() => summarizeRoots(index), [index])
  const open = useMemo(
    () => openRoots(summaries, archive),
    [summaries, archive],
  )
  const work = useMemo(() => rootWork(index, lanes), [index, lanes])
  const labelOf = (root: string): string => {
    const first = summaries.find(s => s.root === root)?.first ?? root
    const text = messageText(index.entries[first]?.message).trim()
    const line = text.split("\n")[0] ?? ""
    return line.length > 40 ? `${line.slice(0, 40)}…` : line || "(no text)"
  }

  const [layout, dispatch] = useReducer(
    layoutReducer,
    undefined,
    () => layoutStore.load() ?? initialLayout(),
  )
  useEffect(() => dispatch({ kind: "sync", index, lanes }), [index, lanes])
  // Every change is saved, `sync`'s too: restored from an older anchor,
  // `followTip` could land on a newer branch below it.
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
    if (settled) dispatch({ kind: "prune", index, open })
  }, [settled])

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
  const columns: readonly ColumnSpec[] =
    active === null
      ? []
      : active.kind === "root"
        ? columnsOf(layout, active.root)
        : active.kind === "new"
          ? layout.newTabs.filter(c => c.key === active.key)
          : []
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
  const closeNewTab = (key: string) =>
    dispatch({
      kind: "closeNewTab",
      key,
      fallback:
        open.length > 0
          ? { kind: "root", root: open.at(-1) ?? "" }
          : { kind: "archive" },
    })

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
  const readers = useMemo(
    () => rootReaders(index, here.readingAt),
    [index, here],
  )
  const colorOf = useMemo(
    () => presenceColors(writerOrder(index, nameOf.keys())),
    [index, nameOf],
  )
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

  const strip = useRef<HTMLDivElement>(null)

  // Align each column once, when it appears. A column of another tab is
  // unmounted, so it is aligned again when its tab is shown.
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
      if (i > 0) alignOnOpen(el, column.key, views[i]?.forkFrom ?? null)
    }
  }, [columns, views])

  // A message to scroll to once its tab is drawn.
  const scrollTo = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = scrollTo.current
    if (id === null) return
    const el = strip.current?.querySelector(`.msg[data-entry="${id}"]`)
    if (el === null || el === undefined) return
    scrollTo.current = null
    el.scrollIntoView({ block: "center" })
  })

  // The Archive tab's own state: never stored.
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all")
  const [archiveQuery, setArchiveQuery] = useState("")
  const [archivePick, setArchivePick] = useState<string | null>(null)

  /** Show entry `id`, wherever it is (`planOpen`). */
  const openAt = (id: string) => {
    const plan = planOpen(layout, index, archive, id)
    if (plan === null) return
    switch (plan.kind) {
      case "scroll":
        scrollTo.current = id
        dispatch({ kind: "show", tab: { kind: "root", root: plan.root } })
        return
      case "open":
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
    colorOf,
    editing: presenceFacts.editing,
    index,
    lanes,
    nameOf,
    notes,
    outbox,
    participants,
    refs,
    session,
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
        <h1>pineta</h1>
        <div className="meta">
          <NameField session={session} /> · entries{" "}
          <span id="count">{count}</span> ·{" "}
          <span id="status">
            {status === "pending" ? "syncing…" : "connected"}
          </span>
        </div>
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
            newLabel={key =>
              layout.newTabs.find(c => c.key === key)?.asksAgent === true
                ? "new agent"
                : "new conversation"
            }
            onAdd={asksAgent =>
              dispatch({ kind: "newTab", key: crypto.randomUUID(), asksAgent })
            }
            onArchive={r => void session.archive("archive", entryId(r))}
            onCloseNew={closeNewTab}
            onShow={tab => dispatch({ kind: "show", tab })}
            readers={readers}
            tabs={tabBar(open, active, layout.newTabs)}
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
                  archive,
                  notes,
                  index,
                  lanes,
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
                        lanes,
                        "all",
                        session.writer,
                        root,
                      ).length,
                      open: notesOpen,
                      toggle: () => setNotesOpen(!notesOpen),
                    }}
                    onPick={openAt}
                    open={shown}
                    rows={rail}
                  />
                )}
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
                      lanes,
                      noteFilter,
                      session.writer,
                      root,
                    )}
                    session={session}
                  />
                )}
                <div id="strip" ref={strip}>
                  {views.map((view, i) => {
                    const column = columns[i]
                    if (column === undefined) return null
                    return (
                      <Column
                        {...shared}
                        column={column}
                        forks={colors.forks}
                        key={column.key}
                        onBranch={at =>
                          act({
                            kind: "openFresh",
                            key: crypto.randomUUID(),
                            at,
                            after: i,
                          })
                        }
                        onBranchInstead={(at, text) =>
                          act({
                            kind: "openFresh",
                            key: crypto.randomUUID(),
                            at,
                            after: i,
                            text,
                          })
                        }
                        onClose={() =>
                          newTab !== null
                            ? closeNewTab(newTab.key)
                            : act({ kind: "close", index: i })
                        }
                        onMakeMain={() => act({ kind: "makeMain", index: i })}
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
 * A root, read-only, in the Archive tab: its rail, and one column that a rail
 * dot moves. Its anchor is its own state, never stored.
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
    | "column"
    | "forks"
    | "onBranch"
    | "onBranchInstead"
    | "onClose"
    | "onMakeMain"
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
  const { index } = shared
  const column: ColumnSpec = { key: `preview-${root}`, anchor }
  const [view] = projectColumns(index, [{ anchor }], noteEntries)
  const rail = projectRail(index, root)
  const path = pathIds(index, view?.tipId ?? null)
  const track = branchColors(rail, view === undefined ? [] : [view]).track[0]
  const none = () => {}
  if (view === undefined) return null
  return (
    <div className="preview">
      <Rail
        activity={shared.activity}
        here={rings}
        notes={noteEntries}
        onPick={setAnchor}
        open={path}
        rows={rail}
      />
      <div className="preview-strip">
        <Column
          {...shared}
          column={column}
          forks={new Map()}
          onBranch={none}
          onBranchInstead={none}
          onClose={none}
          onMakeMain={none}
          onOpen={setAnchor}
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
// Who this tab is: Kyneta's per-tab lease. A reload keeps the id, so you stay
// yourself, your name with you; a second tab open at once gets its own, except
// a duplicated one, which shares it (S29).
const session = await connectSession({
  url: wsUrl,
  WebSocket,
  peerId: persistentPeerId("pineta-peer-id"),
})

const root = document.getElementById("root")
if (root === null) throw new Error("client/app: missing #root in the page")

createRoot(root).render(
  <StrictMode>
    <ExchangeProvider exchange={session.exchange}>
      <App session={session} />
    </ExchangeProvider>
  </StrictMode>,
)
