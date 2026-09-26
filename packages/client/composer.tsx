// client/composer — one per column, sending at the end of its path.

import {
  address,
  agentByDefault,
  type ChatMode,
  type LaneName,
  type Position,
  parseMentions,
  type ThreadLane,
} from "@pineta/core"
import { useEffect, useRef, useState } from "react"
import type { SessionClient } from "./session-view.ts"

/**
 * Before sending, the composer's button says what the message will do: who it
 * is for, and whether it will wait. The same `address` the host runs decides
 * it, over the thread `threadOf` gives, both read through `@pineta/reads` as
 * the host reads them (ADR-0021).
 *
 * A reply carries the end its sender saw. If another writer's compelled
 * message got there first, the host writes nothing and says so (`conflict`),
 * and the sender chooses: wait behind them, or branch here.
 */
export function Composer({
  session,
  at,
  lane,
  boundLane,
  asksAgent,
  fresh,
  participants,
  holderName,
  onSend,
  onBranchInstead,
  pending,
  typing,
  onTyping,
}: {
  session: SessionClient
  /** Where the message attaches: the column's end, or its branch point. */
  at: Position
  /** The thread's lane, from `threadOf`: whether the agent is busy there. */
  lane: ThreadLane
  /** The lane this column is bound to, which its sends name. */
  boundLane: LaneName | undefined
  /** A Start Agent column. */
  asksAgent: boolean
  /** A fresh column: its first message starts the thread (`branch`). */
  fresh: boolean
  /** Everyone who can be mentioned, as shown. */
  participants: readonly string[]
  /** Who the agent is answering, or who waits first, by name. */
  holderName: string | null
  /** A fresh column's send id, recorded before its message is sent. */
  onSend: () => string | undefined
  /** After a conflict: open a branch at `at`, which sends the message. */
  onBranchInstead: (text: string) => void
  /** A first message to send at once: this column was opened to send it. */
  pending: string | undefined
  /** Others typing here, by name (presence). */
  typing: readonly string[]
  /** Called on each keystroke; presence is written at most once a second. */
  onTyping: () => void
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const [conflict, setConflict] = useState<{
    text: string
    by: string | null
  } | null>(null)
  const byDefault = agentByDefault({
    mode: fresh ? "branch" : "reply",
    lane,
    asksAgent,
  })
  const to = address({
    mentions: parseMentions(text),
    participants,
    agentByDefault: byDefault,
  })
  const compelled = to.compels.kind === "agent"
  const busy = lane.kind === "lane" && (lane.running || lane.waiting > 0)
  const mode: ChatMode = fresh
    ? "branch"
    : compelled && busy
      ? "queue"
      : "reply"
  const label = compelled
    ? busy && !fresh
      ? `queue · agent replies after ${holderName ?? "the others"}`
      : "send · agent will reply"
    : to.people.length > 0
      ? `send · to ${to.people.join(", ")}`
      : "send"

  const send = async (message: string, as: ChatMode) => {
    setStatus("sending…")
    const id = onSend()
    const outcome = await session.chat(message, at, {
      mode: as,
      ...(boundLane === undefined ? {} : { lane: boundLane }),
      asksAgent,
      ...(id === undefined ? {} : { id }),
    })
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

  // Sent once, however often React runs effects (StrictMode runs them twice).
  const sentPending = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (pending === undefined || sentPending.current) return
    sentPending.current = true
    void send(pending, "branch")
  }, [])

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
            {conflict.by === null
              ? "Another thread started here a moment before you."
              : `${conflict.by} asked the agent a moment before you.`}
          </span>{" "}
          <button
            className="queue-after"
            onClick={() => {
              setText("")
              void send(conflict.text, "queue")
            }}
            type="button"
          >
            {conflict.by === null ? "Queue" : `Queue after ${conflict.by}`}
          </button>{" "}
          <button
            className="branch-instead"
            onClick={() => {
              setText("")
              setConflict(null)
              onBranchInstead(conflict.text)
            }}
            type="button"
          >
            Branch here
          </button>
        </div>
      )}
      {lane.kind === "lane" && lane.running && (
        <button
          className="stop"
          onClick={() => void session.stop(lane.name)}
          title="end the agent's turn here; messages waiting are then taken"
          type="button"
        >
          Stop
        </button>
      )}
      {typing.length > 0 && (
        <div className="typing">
          {typing.join(", ")} {typing.length === 1 ? "is" : "are"} typing…
        </div>
      )}
      <div className="compose-row">
        <input
          autoComplete="off"
          className="input"
          onChange={e => {
            setText(e.target.value)
            onTyping()
          }}
          placeholder={
            byDefault ? "ask the agent…" : "say something · @agent to ask"
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
