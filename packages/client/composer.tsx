// client/composer — one per column, sending at the end of its path.

import {
  compelledResponder,
  entryId,
  NOBODY,
  parseMentions,
  type Responder,
} from "@pineta/core"
import { useState } from "react"
import type { SessionClient } from "./session-view.ts"

/**
 * Before sending, the composer says who will see the message and whether the
 * agent must answer it. The same `compelledResponder` the host runs decides
 * the label, from the rule in force where the message will attach, so it
 * cannot promise a reply the host will not start.
 */
export function Composer({
  session,
  at,
  rule,
  names,
  fresh,
}: {
  session: SessionClient
  /** Where the message attaches: the column's last message, or null in an empty session. */
  at: string | null
  /** The rule in force at `at`. */
  rule: Responder
  names: readonly string[]
  /** A fresh branch, with nothing in it yet. */
  fresh: boolean
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const willReply =
    compelledResponder({
      mentions: parseMentions(text),
      threadDefault: rule.kind === "agent" ? rule : NOBODY,
    }).kind === "agent"

  return (
    <form
      className="composer"
      onSubmit={async event => {
        event.preventDefault()
        const message = text.trim()
        if (message === "") return
        setText("")
        setStatus("sending…")
        const outcome = await session.chat(
          message,
          at === null ? undefined : { kind: "entry", id: entryId(at) },
        )
        setStatus(
          outcome.kind === "refused" ? `not sent: ${outcome.message}` : "",
        )
      }}
    >
      <div className="audience">
        seen by{" "}
        <span className="seen-by">{names.join(", ") || "everyone here"}</span>
        {willReply && (
          <>
            {" "}
            · <span className="will-reply">agent will reply</span>
          </>
        )}
      </div>
      <div className="compose-row">
        <input
          autoComplete="off"
          className="input"
          onChange={e => setText(e.target.value)}
          placeholder={
            fresh
              ? "start a branch here…"
              : rule.kind === "agent"
                ? "ask the agent…"
                : "say something · @agent to ask"
          }
          value={text}
        />
        <button className="send" type="submit">
          {willReply ? "send · agent will reply" : "send"}
        </button>
      </div>
      <span className="status">{status}</span>
    </form>
  )
}
