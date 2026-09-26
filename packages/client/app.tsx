// client/app — browser entry. Vite transforms and serves this directly.
//
// The screen is a rail and a strip of columns (docs/06-interface.md). The rail
// draws the whole tree; each column is one path, read on its own scroll. What
// is drawn is a read of the document, through `projection.ts`. Which columns
// are open, and in what order, is this window's own view state: a reducer
// (`columns.ts`), never written.
//
// The renderer before React rebuilt the transcript with `innerHTML` on every
// change, which destroyed focus and selection on every keystroke. React gives
// stable node identity, which `useText` needs to keep a note's textarea
// bound while everyone types (ADR-0025).

import { persistentPeerId } from "@kyneta/exchange"
import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import {
  ancestry,
  branchColors,
  PENDING_TRACK,
  pathIds,
  presenceView,
  projectColumns,
  projectRail,
  type TreeIndex,
} from "@pineta/core"
import { noteEntry } from "@pineta/marginalia"
import {
  type NoteFilter,
  notesIndex,
  readAgentActivity,
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
import { Column } from "./column.tsx"
import { columnsReducer, initialColumns, isPinned } from "./columns.ts"
import { NotesIndex } from "./note.tsx"
import { nameFor, presenceColors, writerOrder } from "./presence.tsx"
import { readEntryCount } from "./projection.ts"
import { Rail } from "./rail.tsx"
import { connectSession, type SessionClient } from "./session-view.ts"

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
 * The column a new path should open beside: the one sharing the deepest
 * ancestor with `id`, so its colour link is short to follow. Pure.
 */
function openBeside(
  index: TreeIndex,
  paths: readonly ReadonlySet<string>[],
  id: string,
): number {
  const up = ancestry(index, id).path
  let best = paths.length - 1
  let depth = Number.POSITIVE_INFINITY
  for (const [i, path] of paths.entries()) {
    const d = up.findIndex(a => path.has(a))
    if (d >= 0 && d < depth) {
      depth = d
      best = i
    }
  }
  return best
}

/**
 * Bring a newly opened column's first message level with its fork point in
 * the column that shows it. The one imperative layout step: after it, every
 * column scrolls on its own. A column with no fork point opens at its end.
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
  const { index, activity, lanes, outbox, participants, notes } = useTracked(
    () => {
      const index = readTreeIndex(doc)
      return {
        index,
        activity: readAgentActivity(doc, index),
        lanes: readLanes(doc, index),
        outbox: readOutbox(doc),
        participants: readParticipants(doc, index),
        notes: readNotes(doc),
      }
    },
  )
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

  const [columns, dispatch] = useReducer(
    columnsReducer,
    undefined,
    initialColumns,
  )
  useEffect(() => dispatch({ kind: "sync", index, lanes }), [index, lanes])

  const views = useMemo(
    () =>
      projectColumns(
        index,
        columns.map(c => ({ anchor: c.anchor, pinned: isPinned(c) })),
        noteEntries,
      ),
    [index, columns, noteEntries],
  )
  const rail = useMemo(() => projectRail(index), [index])
  const here = useMemo(
    () => presenceView(presenceFacts, session.writer, index),
    [presenceFacts, index, session.writer],
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

  // Report every open column's thread end (ADR-0024: there is no focused
  // column; each is being read). A closed column's entry is deleted. While the
  // page is visible the entries are refreshed, so they outlive their decay.
  // A column with no message yet (an empty session, a fresh root) follows no
  // thread: its end is null, and it reports nothing.
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

  // Align each column once, when it first appears.
  const aligned = useRef(new Set<string>())
  useLayoutEffect(() => {
    const el = strip.current
    if (el === null) return
    for (const [i, column] of columns.entries()) {
      if (aligned.current.has(column.key)) continue
      aligned.current.add(column.key)
      if (i > 0) alignOnOpen(el, column.key, views[i]?.forkFrom ?? null)
    }
  }, [columns, views])

  /** Open the path through `id`, or scroll to it if a column already shows it. */
  const openAt = (id: string) => {
    // A message on a shared stretch of paths is drawn once, in the leftmost
    // column that shows it, so look in every column.
    if (shown.has(id)) {
      strip.current
        ?.querySelector(`.msg[data-entry="${id}"]`)
        ?.scrollIntoView({ block: "center" })
      return
    }
    dispatch({
      kind: "open",
      key: crypto.randomUUID(),
      after: openBeside(index, paths, id),
      anchor: id,
    })
  }

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
      <main id="workspace">
        <Rail
          activity={activity}
          here={rings}
          notes={noteEntries}
          notesPanel={{
            count: notes.length,
            open: notesOpen,
            toggle: () => setNotesOpen(!notesOpen),
          }}
          onPick={openAt}
          onStart={asksAgent =>
            dispatch({
              kind: "openFresh",
              key: crypto.randomUUID(),
              at: null,
              asksAgent,
              place: { end: true },
            })
          }
          open={shown}
          rows={rail}
        />
        {/* Over the columns, beside the rail: inside the rail, whose own
            scroll clips what overflows it, only a sliver of it showed. */}
        {notesOpen && (
          <NotesIndex
            filter={noteFilter}
            nameOf={nameOf}
            onClose={() => setNotesOpen(false)}
            onFilter={setNoteFilter}
            onPick={at => {
              setNotesOpen(false)
              openAt(at)
            }}
            rows={notesIndex(notes, index, lanes, noteFilter, session.writer)}
            session={session}
          />
        )}
        <div id="strip" ref={strip}>
          {views.map((view, i) => {
            const column = columns[i]
            if (column === undefined) return null
            return (
              <Column
                activity={activity}
                colorOf={colorOf}
                column={column}
                editing={presenceFacts.editing}
                forks={colors.forks}
                notes={notes}
                index={index}
                key={column.key}
                lanes={lanes}
                nameOf={nameOf}
                outbox={outbox}
                onBranch={at =>
                  dispatch({
                    kind: "openFresh",
                    key: crypto.randomUUID(),
                    at,
                    asksAgent: false,
                    place: { after: i },
                  })
                }
                onBranchInstead={(at, text) =>
                  dispatch({
                    kind: "openFresh",
                    key: crypto.randomUUID(),
                    at: at.kind === "root" ? null : at.id,
                    asksAgent: false,
                    place: { after: i },
                    text,
                  })
                }
                onSent={sendId =>
                  dispatch({ kind: "sent", key: column.key, sendId })
                }
                onStart={asksAgent =>
                  dispatch({
                    kind: "openFresh",
                    key: crypto.randomUUID(),
                    at: null,
                    asksAgent,
                    place: { replace: i },
                  })
                }
                onClose={() => dispatch({ kind: "close", index: i })}
                onMakeMain={() => dispatch({ kind: "makeMain", index: i })}
                onOpen={openAt}
                path={paths[i] ?? new Set()}
                position={i}
                onTyping={() => typing(views[i]?.tipId ?? null)}
                participants={participants}
                refs={refs}
                seenBy={view.tipId === null ? [] : here.seenBy(view.tipId)}
                typing={view.tipId === null ? [] : here.typingAt(view.tipId)}
                session={session}
                shown={shown}
                track={colors.track[i] ?? PENDING_TRACK}
                view={view}
              />
            )
          })}
        </div>
      </main>
    </>
  )
}

// ── mount ─────────────────────────────────────────────────────────────────
//
// connectSession owns the Exchange, so ExchangeProvider is handed that same
// connection rather than opening a second one. The e2e check drives the exact
// same function in Node.

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
// Who this tab is: Kyneta's per-tab lease. A reload keeps the id, so you stay
// yourself, your name with you; a second tab open at once gets its own.
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
