// client/app — browser entry. Vite transforms and serves this directly.
//
// The renderer this replaced rebuilt the whole transcript with `innerHTML` on
// every change. That is O(entries) DOM churn per token delta, and — decisively
// — it destroys focus and selection on every keystroke, which makes a
// collaborative composer impossible. React gives us stable node identity, and
// `useText` gives us the composer itself.

import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import type { BranchSummary } from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  readEntryCount,
  readLane,
  readLaneTipId,
  readSpine,
  readStreaming,
} from "./projection.ts"
import { connectSession, type SessionClient } from "./session-view.ts"

// ── the transcript ────────────────────────────────────────────────────────
//
// Order comes from the parentId walk, never from seq (ADR-0013: nothing may
// render by seq order). React keys are entry ids for the same reason they are
// durable in the doc: seq is a replica-local arrival index and would reorder
// under a late arrival, silently remounting rows.

/**
 * The spine reads as an ordinary transcript, at full contrast, because that is
 * what is in context. Branches hang off it, dimmed and inset, because they are
 * not. The gap between those two sets is what Pineta adds over a transcript.
 */
function Spine({
  doc,
  selectedTipId,
  onRead,
}: {
  doc: SessionDocHandle
  selectedTipId: string | null
  onRead: (tipId: string) => void
}) {
  const { spine } = useTracked(() => readSpine(doc, selectedTipId))

  return (
    <div id="transcript">
      {spine.map(node => (
        <div key={node.id}>
          <div className={`msg ${node.role}`}>
            <span className="role">{node.role}</span>
            {/* JSX escapes by default, so model output is never HTML. */}
            <div className="text">{node.text}</div>
          </div>
          {node.branches.length > 0 && (
            <BranchMarker branches={node.branches} onRead={onRead} />
          )}
        </div>
      ))}
    </div>
  )
}

function BranchMarker({
  branches,
  onRead,
}: {
  branches: readonly BranchSummary[]
  onRead: (tipId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const messages = branches.reduce((n, b) => n + b.messageCount, 0)

  return (
    <div className="fork" data-branches={branches.length}>
      <button onClick={() => setOpen(!open)} type="button">
        ⑂ {branches.length} branch{branches.length === 1 ? "" : "es"} ·{" "}
        {messages} message{messages === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="branches">
          {/* Stated in words, not by dimming alone: the boundary has to
              survive greyscale and low contrast. */}
          <div className="outside">not in your context</div>
          {branches.map(b => (
            <div className="branch" key={b.rootId}>
              <span className="branch-id">{b.rootId.slice(0, 8)}</span>
              <span className="branch-count">
                {b.messageCount} message{b.messageCount === 1 ? "" : "s"}
              </span>
              <button onClick={() => onRead(b.tipId)} type="button">
                read
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Live token deltas. Reading `activeRunId` and the stream separately means a
 * delta re-renders only this component — the transcript above does not move,
 * which is the whole point of the port.
 */
function Streaming({ doc }: { doc: SessionDocHandle }) {
  const streaming = useTracked(() => readStreaming(doc))
  return (
    <div hidden={streaming === null} id="streaming">
      <span className="role">assistant</span>
      <div className="text" id="streamText">
        {streaming?.text ?? ""}
      </div>
    </div>
  )
}

/**
 * Naming the parent is a correctness affordance, not decoration. Selection is
 * client-local, so reading a branch and then prompting would otherwise append
 * silently to a lane tip you navigated away from.
 *
 * Off-lane the composer BRANCHES from the selected entry rather than refusing:
 * the host navigates there first, so the turn forks from what you are reading.
 */
function Composer({
  session,
  onLane,
  selectedTipId,
  onBranched,
}: {
  session: SessionClient
  onLane: boolean
  selectedTipId: string | null
  onBranched: () => void
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("connected")

  return (
    <form
      id="form"
      onSubmit={async event => {
        event.preventDefault()
        const prompt = text.trim()
        if (prompt === "") return
        setText("")
        setStatus(onLane ? "running…" : "branching…")
        const reply = await session.prompt(
          prompt,
          onLane ? null : selectedTipId,
        )
        setStatus(
          reply.accepted
            ? "connected"
            : `rejected: ${reply.errorCode} — ${reply.errorMessage}`,
        )
        // The lane tip has moved onto the new entry, so drop the local
        // selection and let the spine follow the lane again. A stale selection
        // would show a path we are no longer appending to.
        if (reply.accepted && !onLane) onBranched()
      }}
    >
      <input
        autoComplete="off"
        id="input"
        onChange={e => setText(e.target.value)}
        placeholder={onLane ? "say something…" : "branch from here…"}
        value={text}
      />
      <button id="send" type="submit">
        {onLane ? "send" : "branch from here"}
      </button>
      <span id="status">{status}</span>
    </form>
  )
}

function App({ session }: { session: SessionClient }) {
  const doc = session.doc
  const lane = useTracked(() => readLane(doc))
  const count = useTracked(() => readEntryCount(doc))
  const status = useDocStatus(doc)
  const laneTipId = useTracked(() => readLaneTipId(doc))

  // Which path you are LOOKING at. Client-local, never written: that is what
  // makes navigation read-only. `null` means follow the lane tip.
  const [selected, setSelected] = useState<string | null>(null)
  const selectedTipId = selected ?? laneTipId
  const onLane = selected === null || selected === laneTipId

  return (
    <>
      <header>
        <h1>pineta</h1>
        <div className="meta">
          lane <span id="lane">{lane ?? "(none)"}</span> · entries{" "}
          <span id="count">{count}</span> ·{" "}
          {status === "pending" ? "syncing…" : status}
        </div>
      </header>
      <Spine doc={doc} onRead={setSelected} selectedTipId={selectedTipId} />
      {onLane ? null : (
        <div id="offLane">
          reading a branch · sending will fork from here{" "}
          <button onClick={() => setSelected(null)} type="button">
            return to your lane
          </button>
        </div>
      )}
      <Streaming doc={doc} />
      <Composer
        onBranched={() => setSelected(null)}
        onLane={onLane}
        selectedTipId={selectedTipId}
        session={session}
      />
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
