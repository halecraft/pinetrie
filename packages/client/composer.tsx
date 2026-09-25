// client/composer — one per column, sending at the end of its path.

import {
  atEntry,
  type ChatMode,
  compelledResponder,
  entryId,
  NOBODY,
  type Position,
  parseMentions,
  type Responder,
  ROOT,
  type ThreadLane,
} from "@pineta/core"
import { useState } from "react"
import type { SessionClient } from "./session-view.ts"

/**
 * Before sending, the composer says who will see the message, whether the
 * agent must answer it, and whether it will wait. The same
 * `compelledResponder` the host runs decides the label, from the rule in force
 * where the message attaches and the thread lane's state, both read through
 * `@pineta/reads` as the host reads them.
 *
 * A reply carries the end its sender saw. If another writer's compelled
 * message got there first, the host writes nothing and says so (`conflict`),
 * and the sender chooses: wait behind them, or branch here.
 */
export function Composer({
  session,
  at,
  rule,
  lane,
  holderName,
  fresh,
}: {
  session: SessionClient
  /** Where the message attaches: the column's last message, or null in an empty session. */
  at: string | null
  /** The rule in force at `at`. */
  rule: Responder
  /** The thread's lane at `at`: whether the agent is busy there. */
  lane: ThreadLane
  /** Who the agent is answering, or who waits first, by name. */
  holderName: string | null
  /** A fresh branch, with nothing in it yet: a message here makes the fork. */
  fresh: boolean
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const [conflict, setConflict] = useState<{ text: string; by: string } | null>(
    null,
  )
  const where: Position = at === null ? ROOT : atEntry(entryId(at))
  const compelled =
    compelledResponder({
      mentions: parseMentions(text),
      threadDefault: rule.kind === "agent" ? rule : NOBODY,
    }).kind === "agent"
  const busy = lane.kind === "lane" && (lane.running || lane.waiting > 0)
  const mode: ChatMode = fresh
    ? "branch"
    : compelled && busy
      ? "queue"
      : "reply"
  const label = !compelled
    ? "send"
    : busy && !fresh
      ? `queue · agent replies after ${holderName ?? "the others"}`
      : "send · agent will reply"

  const send = async (message: string, as: ChatMode) => {
    setStatus("sending…")
    const outcome = await session.chat(message, where, as)
    if (outcome.kind === "conflict") {
      setConflict({ text: message, by: outcome.by })
      setText(message)
      setStatus("")
      return
    }
    setConflict(null)
    setStatus(
      outcome.kind === "refused"
        ? `not sent: ${outcome.message}`
        : outcome.kind === "queued"
          ? `waiting · ${ordinal(outcome.position + 1)} in line`
          : "",
    )
  }

  return (
    <form
      className="composer"
      onSubmit={async event => {
        event.preventDefault()
        const message = text.trim()
        if (message === "") return
        setText("")
        await send(message, mode)
      }}
    >
      {conflict !== null && (
        <div className="conflict">
          <span className="conflict-text">
            {conflict.by} asked the agent a moment before you.
          </span>{" "}
          <button
            className="queue-after"
            onClick={() => {
              setText("")
              void send(conflict.text, "queue")
            }}
            type="button"
          >
            Queue after {conflict.by}
          </button>{" "}
          <button
            className="branch-instead"
            onClick={() => {
              setText("")
              void send(conflict.text, "branch")
            }}
            type="button"
          >
            Branch here
          </button>
        </div>
      )}
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
          {label}
        </button>
      </div>
      <span className="status">{status}</span>
    </form>
  )
}

const ordinal = (n: number): string =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`
