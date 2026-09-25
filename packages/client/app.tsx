// client/app — browser entry. Vite transforms and serves this directly.
//
// The renderer this replaced rebuilt the whole transcript with `innerHTML` on
// every change. That is O(entries) DOM churn per token delta, and — decisively
// — it destroys focus and selection on every keystroke, which makes a
// collaborative composer impossible. React gives us stable node identity;
// `useText` is for shared composition, which is not built yet.

import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import {
  type BranchSummary,
  compelledResponder,
  entryId,
  laneNameForAgent,
  NOBODY,
  parseMentions,
  type ReferenceTarget,
  THE_AGENT,
} from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  readEntryCount,
  readParticipantNames,
  readReferences,
  readSpine,
  readStreaming,
  readThreadMode,
  readViewTip,
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
  onCite,
}: {
  doc: SessionDocHandle
  selectedTipId: string | null
  onRead: (tipId: string) => void
  onCite: (to: ReferenceTarget) => void
}) {
  const { spine } = useTracked(() => readSpine(doc, selectedTipId))
  const refs = useTracked(() => readReferences(doc))
  // The agent joins a thread at the first message on the path that compelled
  // it: from there on, what is above is its context.
  const joinedAt = spine.find(n => n.compelled === true)?.id

  return (
    <div id="transcript">
      {spine.map(node => {
        const id = entryId(node.id)
        const cites = refs.from.get(id) ?? []
        const citedBy = refs.to.get(id) ?? []
        return (
          <div key={node.id}>
            {node.id === joinedAt && (
              <div className="joined">agent joined · it reads this thread</div>
            )}
            <div
              className={`msg ${node.role}${node.compelled === true ? " asked" : ""}`}
              data-entry={node.id}
            >
              <span className="role">
                {node.role === "chat" ? node.author : node.role}
              </span>
              {/* JSX escapes by default, so model output is never HTML. */}
              <div className="text">{node.text}</div>
              <div className="refs">
                <button
                  className="cite"
                  // Keep the text selection alive through the click.
                  onMouseDown={e => e.preventDefault()}
                  onClick={e => {
                    const text = e.currentTarget
                      .closest(".msg")
                      ?.querySelector(".text")
                    const span = text ? selectedSpan(text) : null
                    onCite(
                      span === null
                        ? { kind: "entry", id }
                        : { kind: "span", id, ...span },
                    )
                  }}
                  type="button"
                >
                  cite
                </button>
                {cites.length > 0 && (
                  <span className="cites" data-cites={cites.length}>
                    ↗ cites {cites.length}
                  </span>
                )}
                {citedBy.length > 0 && (
                  <span
                    className="cited-by"
                    data-cited-by={citedBy.length}
                    title={citedBy.map(r => r.author).join(", ")}
                  >
                    ↙ cited by {citedBy.length}
                  </span>
                )}
              </div>
            </div>
            {node.branches.length > 0 && (
              <BranchMarker branches={node.branches} onRead={onRead} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The selection inside `text`, as UTF-16 offsets into its rendered string, or
 * null if nothing inside it is selected. The element renders exactly
 * `entryText`, so these are the offsets a span reference means.
 */
function selectedSpan(text: Element): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0)
    return null
  const range = selection.getRangeAt(0)
  if (
    !text.contains(range.startContainer) ||
    !text.contains(range.endContainer)
  )
    return null
  const before = document.createRange()
  before.selectNodeContents(text)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const end = start + range.toString().length
  return end > start ? { start, end } : null
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
function Streaming({ doc, lane }: { doc: SessionDocHandle; lane: string }) {
  const streaming = useTracked(() => readStreaming(doc, lane))
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
 * Before sending, the composer says who will see the message and who must
 * answer it. Everyone in the session can read it; only the agent can be
 * compelled, by an `@agent` or by a working session. The same
 * `compelledResponder` the host runs decides the label, so it cannot promise
 * a reply the host will not start.
 */
function Composer({
  session,
  viewTipId,
  onSent,
}: {
  session: SessionClient
  viewTipId: string | null
  onSent: (at: string | null) => void
}) {
  const doc = session.doc
  const [text, setText] = useState("")
  const [status, setStatus] = useState("connected")
  const mode = useTracked(() => readThreadMode(doc, viewTipId))
  const names = useTracked(() => readParticipantNames(doc))
  const willReply =
    compelledResponder({
      mentions: parseMentions(text),
      threadDefault:
        mode === "session" ? { kind: "agent", agent: THE_AGENT } : NOBODY,
    }).kind === "agent"

  return (
    <form
      id="form"
      onSubmit={async event => {
        event.preventDefault()
        const message = text.trim()
        if (message === "") return
        setText("")
        setStatus("sending…")
        const outcome = await session.chat(
          message,
          viewTipId === null
            ? undefined
            : { kind: "entry", id: entryId(viewTipId) },
        )
        setStatus(
          outcome.kind === "refused"
            ? `rejected: ${outcome.code} — ${outcome.message}`
            : "connected",
        )
        // Stay in this thread, and follow it as replies arrive.
        if (outcome.kind !== "refused") onSent(viewTipId)
      }}
    >
      <div id="audience">
        seen by{" "}
        <span id="seenBy">
          {[...names.values()].join(", ") || "everyone here"}
        </span>
        {willReply && (
          <>
            {" "}
            · will reply <span id="willReply">agent</span>
          </>
        )}
      </div>
      <input
        autoComplete="off"
        id="input"
        onChange={e => setText(e.target.value)}
        placeholder={
          mode === "session"
            ? "ask the agent…"
            : "say something · @agent to ask"
        }
        value={text}
      />
      <button id="send" type="submit">
        {willReply ? "send · agent will reply" : "send"}
      </button>
      <span id="status">{status}</span>
    </form>
  )
}

/** The thread's mode at what you are reading, and the switch between them. */
function ThreadMode({
  session,
  viewTipId,
}: {
  session: SessionClient
  viewTipId: string | null
}) {
  const mode = useTracked(() => readThreadMode(session.doc, viewTipId))
  return (
    <div data-mode={mode} id="thread">
      {mode === "session"
        ? "working session · the agent answers every message"
        : "conversation · the agent answers when @agent is mentioned"}{" "}
      {/* A mode is set at an entry and inherited below it; an empty session
          has none to set it at. */}
      {viewTipId !== null && (
        <button
          id="threadMode"
          onClick={() =>
            void session.setThreadMode(
              entryId(viewTipId),
              mode === "session" ? "conversation" : "session",
            )
          }
          type="button"
        >
          make this a {mode === "session" ? "conversation" : "working session"}
        </button>
      )}
    </div>
  )
}

/** A display name: a label for you, never your identity. */
function NameField({ session }: { session: SessionClient }) {
  const names = useTracked(() => readParticipantNames(session.doc))
  const [draft, setDraft] = useState<string | null>(null)
  const current = names.get(session.laneName) ?? ""
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

function App({ session }: { session: SessionClient }) {
  const doc = session.doc
  const count = useTracked(() => readEntryCount(doc))
  const status = useDocStatus(doc)

  // What you chose to READ: client-local, never written. Null until you choose,
  // which follows the newest tip overall. The view is the newest tip at or
  // below it, so replies to your thread, the agent's included, move the view
  // on, and someone else's branch never pulls it away (`followTip`).
  const [anchor, setAnchor] = useState<string | null>(null)
  const viewTipId = useTracked(() => readViewTip(doc, anchor))

  return (
    <>
      <header>
        <h1>pineta</h1>
        <div className="meta">
          <NameField session={session} /> · lane{" "}
          <span id="lane">{session.laneName}</span> · entries{" "}
          <span id="count">{count}</span> ·{" "}
          {status === "pending" ? "syncing…" : status}
        </div>
      </header>
      <Spine
        doc={doc}
        onCite={to =>
          void session.cite(
            to,
            viewTipId === null
              ? undefined
              : { kind: "entry", id: entryId(viewTipId) },
          )
        }
        onRead={setAnchor}
        selectedTipId={viewTipId}
      />
      {anchor !== null && (
        <div id="reading">
          reading a thread · sending replies here{" "}
          <button
            id="followLatest"
            onClick={() => setAnchor(null)}
            type="button"
          >
            follow the newest
          </button>
        </div>
      )}
      <Streaming doc={doc} lane={laneNameForAgent(THE_AGENT)} />
      <ThreadMode session={session} viewTipId={viewTipId} />
      <Composer onSent={setAnchor} session={session} viewTipId={viewTipId} />
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
