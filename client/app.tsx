// client/app — browser entry. Vite transforms and serves this directly.
//
// The renderer this replaced rebuilt the whole transcript with `innerHTML` on
// every change. That is O(entries) DOM churn per token delta, and — decisively
// — it destroys focus and selection on every keystroke, which makes a
// collaborative composer impossible. React gives us stable node identity, and
// `useText` gives us the composer itself.

import { ExchangeProvider, useDocStatus, useTracked } from "@kyneta/react"
import type { SessionDocHandle } from "@pineta/schema"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  readEntryCount,
  readLane,
  readStreaming,
  readTranscript,
} from "./projection.ts"
import { connectSession, type SessionClient } from "./session-view.ts"

// ── the transcript ────────────────────────────────────────────────────────
//
// Order comes from the parentId walk, never from seq (ADR-0013: nothing may
// render by seq order). React keys are entry ids for the same reason they are
// durable in the doc: seq is a replica-local arrival index and would reorder
// under a late arrival, silently remounting rows.

function Transcript({ doc }: { doc: SessionDocHandle }) {
  const transcript = useTracked(() => readTranscript(doc))

  return (
    <div id="transcript">
      {transcript.map(m => (
        <div className={`msg ${m.role}`} key={m.id}>
          <span className="role">{m.role}</span>
          {/* JSX escapes by default, so model output is never HTML. */}
          <div className="text">{m.text}</div>
        </div>
      ))}
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

function Composer({ session }: { session: SessionClient }) {
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
        setStatus("running…")
        const reply = await session.prompt(prompt)
        setStatus(
          reply.accepted
            ? "connected"
            : `rejected: ${reply.errorCode} — ${reply.errorMessage}`,
        )
      }}
    >
      <input
        autoComplete="off"
        id="input"
        onChange={e => setText(e.target.value)}
        placeholder="say something…"
        value={text}
      />
      <button type="submit">send</button>
      <span id="status">{status}</span>
    </form>
  )
}

function App({ session }: { session: SessionClient }) {
  const doc = session.doc
  const lane = useTracked(() => readLane(doc))
  const count = useTracked(() => readEntryCount(doc))
  const status = useDocStatus(doc)

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
      <Transcript doc={doc} />
      <Streaming doc={doc} />
      <Composer session={session} />
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
