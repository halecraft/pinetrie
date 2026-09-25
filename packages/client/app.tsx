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
// stable node identity; `useText` is for shared composition, not built yet.

import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import {
  ancestry,
  branchColors,
  PENDING_TRACK,
  pathIds,
  projectColumns,
  projectRail,
  type TreeIndex,
} from "@pineta/core"
import {
  readAgentActivity,
  readLanes,
  readOutbox,
  readParticipantNames,
  readReferences,
  readThreadRules,
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
import { columnsReducer, initialColumns } from "./columns.ts"
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

function App({ session }: { session: SessionClient }) {
  const doc = session.doc
  const status = useDocStatus(doc)
  const count = useTracked(() => readEntryCount(doc))
  // One moment's facts, read together: the same reads the host decides from.
  const { index, activity, rules, lanes, outbox } = useTracked(() => {
    const index = readTreeIndex(doc)
    return {
      index,
      activity: readAgentActivity(doc, index),
      rules: readThreadRules(doc),
      lanes: readLanes(doc, index),
      outbox: readOutbox(doc),
    }
  })
  const refs = useTracked(() => readReferences(doc))
  const nameOf = useTracked(() => readParticipantNames(doc))

  const [columns, dispatch] = useReducer(
    columnsReducer,
    undefined,
    initialColumns,
  )
  useEffect(() => dispatch({ kind: "sync", index }), [index])

  const views = useMemo(() => projectColumns(index, columns), [index, columns])
  const rail = useMemo(() => projectRail(index), [index])
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
        <Rail activity={activity} onPick={openAt} open={shown} rows={rail} />
        <div id="strip" ref={strip}>
          {views.map((view, i) => {
            const column = columns[i]
            if (column === undefined) return null
            return (
              <Column
                activity={activity}
                columnKey={column.key}
                forks={colors.forks}
                index={index}
                key={column.key}
                lanes={lanes}
                nameOf={nameOf}
                outbox={outbox}
                onBranchHere={at =>
                  dispatch({
                    kind: "branch",
                    key: crypto.randomUUID(),
                    after: i,
                    at,
                    existing: index.childrenOf.get(at) ?? [],
                  })
                }
                onClose={() => dispatch({ kind: "close", index: i })}
                onMakeMain={() => dispatch({ kind: "makeMain", index: i })}
                onOpen={openAt}
                path={paths[i] ?? new Set()}
                position={i}
                refs={refs}
                rules={rules}
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
const session = await connectSession({ url: wsUrl, WebSocket })

const root = document.getElementById("root")
if (root === null) throw new Error("client/app: missing #root in the page")

createRoot(root).render(
  <StrictMode>
    <ExchangeProvider exchange={session.exchange}>
      <App session={session} />
    </ExchangeProvider>
  </StrictMode>,
)
