// client/composer — one per column, sending at the end of its path.

import {
  address,
  agentByDefault,
  type ChatMode,
  type CommandSummary,
  type LaneName,
  type Position,
  type ProjectRecord,
  parseMentions,
  type ThreadLane,
  type WorkSetting,
} from "@pineta/core"
import { parseCommand } from "@pineta/marginalia"
import { useEffect, useRef, useState } from "react"
import { matchCommands } from "./commands.ts"
import { Menu } from "./menu.tsx"
import { settleSend } from "./send.ts"
import type { SessionClient } from "./session-view.ts"

/**
 * A column where nothing may be written: an archived root, in place or
 * previewed, or an open root's preview (ADR-0029). The composer keeps what
 * was typed, and shows `label` and `action` in place of its buttons.
 */
export interface ReadOnly {
  readonly label: string
  readonly action: { readonly title: string; readonly go: () => void }
}

/**
 * Before sending, the composer's button says what the message will do: who it
 * is for, and whether it will wait. The same `address` the host runs decides
 * it, over the thread `threadOf` gives, both read through `@pineta/reads` as
 * the host reads them (ADR-0021).
 *
 * A reply carries the end its sender saw. If another writer's compelled
 * message got there first, the host writes nothing and says so (`conflict`),
 * and the sender chooses: wait behind them, or branch here. A message the
 * host refuses comes back to the composer too (`settleSend`).
 */
/** Where a lane works, in the send button's words. */
export function whereWords(
  work: WorkSetting,
  project: ProjectRecord | null,
): string {
  if (work.kind === "own") return "in its own copy"
  return project !== null && work.dir === project.root
    ? "in your working copy"
    : `in ${work.dir}`
}

export function Composer({
  session,
  at,
  lane,
  boundLane,
  asksAgent,
  defaultWork,
  project,
  commands,
  usedDirs,
  fresh,
  participants,
  holderName,
  onSend,
  onBranchInstead,
  pending,
  typing,
  onTyping,
  onComposeTogether,
  readOnly,
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
  /**
   * Where a lane this send creates would work with no choice made: the lane
   * above's setting, else the project's default (`workFor`, as the host
   * decides). Null with no tools.
   */
  defaultWork: WorkSetting | null
  project: ProjectRecord | null
  /** The commands the host's pi loaded, for completion (ADR-0036). */
  commands: readonly CommandSummary[]
  /** Directories other lanes work in directly: offered again. */
  usedDirs: readonly string[]
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
  /**
   * Start this thread's shared draft with what is typed so far (ADR-0025).
   * Undefined where there is none to start: a fresh column, or a thread that
   * already has one.
   */
  onComposeTogether: ((text: string) => void) | undefined
  readOnly: ReadOnly | null
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const [conflict, setConflict] = useState<{
    text: string
    by: string | null
  } | null>(null)
  // Where a lane this send creates works: the column's view state until sent.
  const [choice, setChoice] = useState<WorkSetting | null>(null)
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
  // A command is for the agent, as the host decides (`planChat`).
  const compelled =
    to.compels.kind === "agent" || parseCommand(text.trim()) !== null
  // The commands matching what is typed; Escape hides them for this text.
  const [hidden, setHidden] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const matches = hidden === text ? [] : matchCommands(text, commands)
  const highlighted = matches[Math.min(picked, matches.length - 1)]
  const choose = (name: string) => {
    setText(`/${name} `)
    setPicked(0)
  }
  const busy = lane.kind === "lane" && (lane.running || lane.waiting > 0)
  const mode: ChatMode = fresh
    ? "branch"
    : compelled && busy
      ? "queue"
      : "reply"
  // A compelled send creates a lane where there is none, and a branch always
  // does: then it also says where that lane will work (ADR-0032, ADR-0034).
  const createsLane = compelled && (fresh || lane.kind === "none")
  const work = choice ?? defaultWork
  const label = compelled
    ? busy && !fresh
      ? `queue · agent replies after ${holderName ?? "the others"}`
      : createsLane && work !== null
        ? `send · agent will reply · ${whereWords(work, project)}`
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
      ...(createsLane && choice !== null ? { work: choice } : {}),
    })
    const settled = settleSend(outcome, message)
    setConflict(settled.conflict)
    setStatus(settled.status)
    if (settled.restore !== null) setText(settled.restore)
  }

  // Sent once, however often React runs effects (StrictMode runs them twice).
  const sentPending = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (pending === undefined || sentPending.current) return
    sentPending.current = true
    void send(pending, "branch")
  }, [])

  const submit = async () => {
    const message = text.trim()
    if (message === "" || readOnly !== null) return
    setText("")
    await send(message, mode)
  }

  return (
    <form
      className="composer"
      onSubmit={event => {
        event.preventDefault()
        void submit()
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
      {readOnly === null && lane.kind === "lane" && lane.running && (
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
      {matches.length > 0 && readOnly === null && (
        <div className="command-menu" role="listbox">
          {matches.map(c => (
            <div
              aria-selected={c === highlighted}
              className={c === highlighted ? "command highlighted" : "command"}
              data-command={c.name}
              key={c.name}
              onMouseDown={e => {
                // Before the input loses focus.
                e.preventDefault()
                choose(c.name)
              }}
              role="option"
              // Focus stays in the input; the keys there move the choice.
              tabIndex={-1}
            >
              <span className="command-name">/{c.name}</span>
              {c.argumentHint !== null && (
                <span className="command-hint"> {c.argumentHint}</span>
              )}
              <span className="command-kind"> · {c.kind}</span>
              {c.description !== "" && (
                <span className="command-description"> {c.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Enter sends; Shift+Enter is a new line. It grows with what is
          typed, up to a limit, then scrolls. */}
      <textarea
        autoComplete="off"
        className="input"
        onChange={e => {
          setText(e.target.value)
          setPicked(0)
          onTyping()
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          // While commands are offered, the keys move through them.
          if (highlighted !== undefined) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const step = e.key === "ArrowDown" ? 1 : -1
              setPicked((picked + step + matches.length) % matches.length)
              return
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault()
              choose(highlighted.name)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setHidden(text)
              return
            }
          }
          if (e.key !== "Enter" || e.shiftKey) return
          e.preventDefault()
          void submit()
        }}
        placeholder={
          byDefault ? "ask the agent…" : "say something · @agent to ask"
        }
        readOnly={readOnly !== null}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        value={text}
      />
      {readOnly !== null ? (
        <div className="read-only">
          <span className="read-only-label">{readOnly.label}</span>
          <button
            className="read-only-action"
            onClick={readOnly.action.go}
            type="button"
          >
            {readOnly.action.title}
          </button>
        </div>
      ) : (
        <div className="compose-row">
          {onComposeTogether !== undefined && (
            <button
              className="compose-together"
              onClick={() => {
                onComposeTogether(text)
                setText("")
              }}
              title="write the next message together: everyone here can edit it"
              type="button"
            >
              compose together
            </button>
          )}
          <button className="send" type="submit">
            {label}
          </button>
          {createsLane && project !== null && (
            <Menu
              className="where-menu"
              heading="where the agent works"
              items={[
                {
                  key: "own",
                  label: "in its own copy",
                  className: "where-own",
                  disabled: project.kind !== "lanes",
                  ...(project.kind === "direct"
                    ? { title: project.reason }
                    : {}),
                  onChoose: () => setChoice({ kind: "own" }),
                },
                {
                  key: "yours",
                  label: "directly in your working copy",
                  className: "where-yours",
                  onChoose: () =>
                    setChoice({ kind: "direct", dir: project.root }),
                },
                ...usedDirs
                  .filter(d => d !== project.root)
                  .map(dir => ({
                    key: dir,
                    label: `directly in ${dir}`,
                    className: "where-used",
                    onChoose: () => setChoice({ kind: "direct", dir }),
                  })),
                {
                  key: "other",
                  label: "directly in…",
                  className: "where-other",
                  onChoose: () => {
                    const dir = window
                      .prompt("The directory to work in")
                      ?.trim()
                    if (dir !== undefined && dir !== "")
                      setChoice({ kind: "direct", dir })
                  },
                },
              ]}
              label="where the agent works"
              trigger="▾"
              triggerClassName="where-trigger"
            />
          )}
        </div>
      )}
      <span className="status">{status}</span>
    </form>
  )
}
