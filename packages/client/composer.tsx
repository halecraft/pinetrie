// client/composer — one per column, sending at the end of its path.

import type {
  ChatMode,
  CommandSummary,
  LaneName,
  Position,
  ProjectRecord,
  ThreadLane,
  WorkSetting,
} from "@pineta/core"
import { useEffect, useRef, useState } from "react"
import { matchCommands } from "./commands.ts"
import { Menu } from "./menu.tsx"
import {
  planSend,
  queueWords,
  sendable,
  settleSend,
  whereChoices,
  whereWords,
} from "./send.ts"
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
 * is for, and whether it will wait (`planSend`, which decides as the host
 * will, over the thread `threadOf` gives, ADR-0021). When the send starts an
 * agent, a chip beside it says where that agent will work, and changes it.
 *
 * A reply carries the end its sender saw. If another writer's compelled
 * message got there first, the host writes nothing and says so (`conflict`),
 * and the sender chooses: wait behind them, or branch here. A message the
 * host refuses comes back to the composer too (`settleSend`).
 */
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
  initialText,
  participants,
  holderName,
  onSend,
  onBranchInstead,
  pending,
  prefill,
  typing,
  onTyping,
  onComposeTogether,
  onIntent,
  readOnly,
  takeFocus,
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
  /**
   * Text the box starts with, unsent: a branch's `@agent ` (`branchPrefill`).
   * Alone, it sends nothing.
   */
  initialText: string | undefined
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
  /**
   * Text to put in the box, unsent and editable: an update's intent
   * (ADR-0038). Each new `key` puts it there once, after what is typed.
   */
  prefill: { readonly text: string; readonly key: number } | null
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
  /** Told whether the next send would create a lane, each time that changes. */
  onIntent: (createsLane: boolean) => void
  readOnly: ReadOnly | null
  /** Whether this column was just opened: then the box takes focus, once. */
  takeFocus: () => boolean
}) {
  // A column opened to send `pending` sends it at once, so it starts empty.
  const [text, setText] = useState(
    pending === undefined ? (initialText ?? "") : "",
  )
  const [status, setStatus] = useState("")
  const [conflict, setConflict] = useState<{
    text: string
    by: string | null
  } | null>(null)
  // Where a lane this send creates works: the column's view state until sent.
  const [choice, setChoice] = useState<WorkSetting | null>(null)
  const plan = planSend({
    text,
    fresh,
    lane,
    asksAgent,
    participants,
    holderName,
  })
  // The commands matching what is typed; Escape hides them for this text.
  const [hidden, setHidden] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const matches = hidden === text ? [] : matchCommands(text, commands)
  const highlighted = matches[Math.min(picked, matches.length - 1)]
  const choose = (name: string) => {
    setText(`/${name} `)
    setPicked(0)
  }
  const work = choice ?? defaultWork
  // The column's header says what the next send starts. A callback on the
  // flag, not the text lifted up: the column redraws only when it flips.
  useEffect(() => onIntent(plan.createsLane), [plan.createsLane, onIntent])

  const send = async (message: string, as: ChatMode) => {
    setStatus("sending…")
    const id = onSend()
    const outcome = await session.chat(message, at, {
      mode: as,
      ...(boundLane === undefined ? {} : { lane: boundLane }),
      asksAgent,
      ...(id === undefined ? {} : { id }),
      ...(plan.createsLane && choice !== null ? { work: choice } : {}),
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

  // A column you just opened is for typing in: focus lands after its
  // prefill (`onFocus`). After the strip's alignment, which is a layout
  // effect; the focus scrolls a column opened past the strip's edge into view.
  const input = useRef<HTMLTextAreaElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (takeFocus()) input.current?.focus()
  }, [])

  // A prefill is put in the box once per key, after whatever is already typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per prefill
  useEffect(() => {
    if (prefill === null || prefill.text === "") return
    setText(t => (t.trim() === "" ? prefill.text : `${t}\n\n${prefill.text}`))
  }, [prefill?.key])

  const submit = async () => {
    const message = sendable(text, initialText)
    if (message === null || readOnly !== null) return
    setText("")
    await send(message, plan.mode)
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
            {queueWords(conflict.by)}
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
            branch here
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
        onFocus={e => {
          // Focused while it holds only what it started with: type after it.
          if (initialText === undefined || text !== initialText) return
          const end = e.currentTarget.value.length
          e.currentTarget.setSelectionRange(end, end)
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
        placeholder={plan.placeholder}
        readOnly={readOnly !== null}
        ref={input}
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
          {plan.createsLane && work !== null && project !== null && (
            <Menu
              className="where-menu"
              heading="where the agent works"
              items={whereChoices(project, usedDirs).map(c => ({
                key: c.key,
                label: c.row,
                className: c.className,
                disabled: c.disabled,
                ...(c.title === undefined ? {} : { title: c.title }),
                onChoose: () => {
                  if (c.setting !== null) return setChoice(c.setting)
                  const dir = window.prompt("The directory to work in")?.trim()
                  if (dir !== undefined && dir !== "")
                    setChoice({ kind: "direct", dir })
                },
              }))}
              label="where the agent works"
              trigger={
                <>
                  <span className="where-words" data-work={work.kind}>
                    {whereWords(work, project)}
                  </span>
                  <span className="where-caret">▾</span>
                </>
              }
              triggerClassName="where-trigger"
            />
          )}
          <button
            className="send"
            title={plan.title ?? undefined}
            type="submit"
          >
            {plan.button}
          </button>
        </div>
      )}
      <span className="status">{status}</span>
    </form>
  )
}
