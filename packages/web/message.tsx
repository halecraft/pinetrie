// web/message — one message in a column, and what can be done to it. It
// redraws only when `sameMessageProps` says what it shows changed, and reports
// what the reader asks as a `MessageAct`.

import { useSelector } from "@kyneta/react"
import {
  LINE_ROLES,
  type StreamId,
  type ToolCall,
  type TranscriptMessage,
} from "@pinetrie/core"
import {
  COMMENT,
  callLabel,
  callMark,
  callStatus,
  canvasMarkerWords,
  copyText,
  joinWords,
  type MessageAct,
  type MessageTools,
  NO_MEMORY,
  opens,
  pinnedMarkerWords,
  plural,
  REVEAL_MS,
  type RowMemory,
  type Run,
  retiredWords,
  rowSummary,
  rowView,
  runningFor,
  type ScreenMemory,
  showsText,
  speakerWords,
  taskPinnedMarkerWords,
  toolBody,
} from "@pinetrie/interface"
import { canvasLines } from "@pinetrie/rules"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import { newCardId } from "@pinetrie/session"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StoredImage } from "./blob-image.tsx"
import { COPIED, useCopy } from "./copy.ts"
import { CopyIcon } from "./icons.tsx"
import { type MessageProps, sameMessageProps } from "./message-props.ts"
import { MessageText } from "./message-text.tsx"
import { useTrackColors } from "./palette-context.ts"
import { MessageSource } from "./pane-context.ts"
import { nameFor } from "./presence.tsx"

function MessageView(p: MessageProps) {
  const { node } = p
  const colors = useTrackColors()
  const speaker = speakerWords(node, p.nameOf)
  const classes = [
    "msg",
    node.role,
    LINE_ROLES.has(node.role) ? "host" : "",
    node.compelled === true ? "asked" : "",
  ].filter(c => c !== "")
  // What its tables and images name it by, in the column's pane.
  const source = useMemo<MessageSource>(
    () => ({ kind: "entry", thread: node.thread, entry: node.id }),
    [node.thread, node.id],
  )
  return (
    <MessageSource value={source}>
      {p.join !== undefined && (
        <div className="lane-join" data-thread={p.join.name}>
          {joinWords(p.join)}
        </div>
      )}
      {p.pinned?.canvas !== undefined && (
        <details className="context-read canvas-read">
          <summary>{canvasMarkerWords(p.pinned.canvas)}</summary>
          {canvasLines(p.pinned.canvas).map(line => (
            <div className="canvas-read-line" key={line}>
              {line}
            </div>
          ))}
        </details>
      )}
      {p.pinned?.taskPinned !== undefined && (
        <details className="context-read task-pinned-read">
          <summary>{taskPinnedMarkerWords(p.pinned.taskPinned)}</summary>
          {p.pinned.taskPinned.cards.map(c => (
            <div className="pinned-read-card" key={c.id}>
              <span className="pinned-read-by">{nameFor(p.nameOf, c.by)}</span>
              <div className="pinned-read-text">{c.text}</div>
            </div>
          ))}
          {p.pinned.taskPinned.retired.map(r => (
            <div className="pinned-read-retired" key={r.id}>
              {retiredWords(r.line)}
            </div>
          ))}
        </details>
      )}
      {p.pinned !== undefined &&
        (p.pinned.cards.length > 0 || p.pinned.retired.length > 0) && (
          <details className="pinned-read">
            <summary>{pinnedMarkerWords(p.pinned)}</summary>
            {p.pinned.cards.map(c => (
              <div className="pinned-read-card" key={c.id}>
                <span className="pinned-read-by">
                  {nameFor(p.nameOf, c.by)}
                </span>
                <div className="pinned-read-text">{c.text}</div>
              </div>
            ))}
            {p.pinned.retired.map(r => (
              <div className="pinned-read-retired" key={r.id}>
                {retiredWords(r.line)}
              </div>
            ))}
          </details>
        )}
      <div className={classes.join(" ")} data-entry={node.id}>
        <span className="role">{speaker}</span>
        {p.crossTaskLink !== undefined && (
          // Another task's thread it came from, opened as a fork row's link is;
          // held elsewhere, it opens nothing.
          <button
            className="cross-task-link"
            disabled={!opens(p.crossTaskLink.link)}
            onClick={() =>
              p.crossTaskLink !== undefined &&
              p.onLink(p.crossTaskLink.link, node.id)
            }
            title="show that thread"
            type="button"
          >
            · {p.crossTaskLink.words}
          </button>
        )}
        {node.command !== undefined && (
          <span
            className="command-label"
            title="a command: the agent read its skill or prompt"
          >
            /{node.command}
          </span>
        )}
        {p.forkTracks.map(t => (
          <button
            aria-label="show the branch that forks here"
            className="fork-dot"
            data-color={colors.slot(t)}
            data-track={t}
            key={t}
            onClick={e =>
              e.currentTarget
                .closest("#strip")
                ?.querySelector(`.column[data-track="${t}"]`)
                ?.scrollIntoView({ block: "nearest", inline: "nearest" })
            }
            style={colors.style(t)}
            type="button"
          />
        ))}
        {showsText(node) && (
          <MessageText
            images={node.images}
            mode="committed"
            shared={node.shared}
            text={node.text}
          />
        )}
        {node.toolCalls?.map(call => (
          <ToolRow
            call={call}
            doc={p.live}
            key={call.id}
            rows={p.rows}
            stream={p.streams[call.id]}
          />
        ))}
        <Tools node={node} onAct={p.onAct} tools={p.tools} />
        {p.closedBranches.length > 0 && (
          <div className="actions">
            {p.closedBranches.map(b => (
              <button
                className="open-branch"
                key={b.rootId}
                onClick={() => p.onAct({ kind: "openAt", entry: b.rootId })}
                type="button"
              >
                ⑂ {plural(b.messageCount, "message")}
              </button>
            ))}
          </div>
        )}
      </div>
    </MessageSource>
  )
}

export const Message = memo(MessageView, sameMessageProps)

/**
 * A message's tools, in one row that floats over its top right on hover or
 * focus: buttons under every message would drown the conversation. Copy comes
 * first; `→` comes last, in the right margin, since what it opens appears to
 * the right.
 */
function Tools({
  node,
  tools,
  onAct,
}: {
  node: TranscriptMessage
  tools: MessageTools
  onAct: (act: MessageAct) => void
}) {
  const { edit, branch } = tools
  if (
    !tools.copy &&
    !tools.comment &&
    edit === undefined &&
    branch === undefined
  )
    return null
  return (
    <div className="tools">
      {tools.copy && <CopyButton node={node} />}
      {tools.comment && (
        <button
          aria-label={COMMENT.title}
          className="comment"
          onClick={() =>
            onAct({
              kind: "comment",
              card: newCardId(),
              entry: node.id,
              thread: node.thread,
            })
          }
          title={COMMENT.title}
          type="button"
        >
          {COMMENT.label}
        </button>
      )}
      {edit?.kind === "branch" && (
        <button
          className="edit"
          onClick={() => onAct(edit)}
          title="edit and send again, in a branch beside this one"
          type="button"
        >
          edit
        </button>
      )}
      {edit?.kind === "newTab" && (
        <button
          className="edit-new-tab"
          onClick={() => onAct(edit)}
          title="a new tab starting with this message's text"
          type="button"
        >
          new tab
        </button>
      )}
      {branch !== undefined && (
        <button
          aria-label="open a branch here"
          className="branch"
          onClick={() => onAct(branch)}
          title="open a branch here"
          type="button"
        >
          →
        </button>
      )}
    </div>
  )
}

/**
 * Copies a message's text and tool calls as markdown. Where it can't, a press
 * selects what the message draws of them: its text and its tool rows.
 */
function CopyButton({ node }: { node: TranscriptMessage }) {
  const { copied, copy } = useCopy()
  return (
    <button
      aria-label="copy this message"
      className="copy"
      onClick={e =>
        copy(copyText(node), [
          ...(e.currentTarget
            .closest(".msg")
            ?.querySelectorAll(":scope > .text, :scope > .tool") ?? []),
        ])
      }
      title={copied ? COPIED : "copy this message as markdown"}
      type="button"
    >
      {copied ? "✓" : <CopyIcon />}
    </button>
  )
}

/**
 * One tool call: its tool's word as a tag and its status at its top right, what
 * it touched, what it returned, and a toggle. `rowView` decides how much it
 * draws: the summary shows the command's first lines and the output's last, and
 * the reader's toggle shows both whole. The result is its own entry in the
 * tree, paired here by `projectSpine`; with none yet, the call is still running
 * or was cut off, and its live output is drawn in the same element the result
 * replaces it in. A result's images are drawn in place of its text
 * (`toolBody`), which keeps to their `title`. What it decided is kept in `rows`
 * by the call's id, so a row mounted again starts where it was left.
 */
function ToolRow({
  call,
  stream,
  doc,
  rows,
}: {
  call: ToolCall
  stream: StreamId | undefined
  doc: LiveDocHandle
  rows: ScreenMemory<RowMemory>
}) {
  const status = callStatus(call.result)
  const mark = callMark(status)
  // A result replaces the stream, whether or not the stream has gone yet.
  const live = call.result === undefined ? stream : undefined
  const [memory, setMemory] = useRemembered(rows, call.id)
  const { revealed, open } = memory
  const streamed = useSelector(
    doc,
    useCallback(
      (d: LiveDocHandle) => (live === undefined ? "" : readStreamText(d, live)),
      [live],
    ),
  )
  const summary = useMemo(() => rowSummary(call), [call])
  const view = rowView(
    summary,
    call.result?.text ?? streamed,
    toolBody(call.result),
    open,
  )
  // Set once and never unset: it rings a call that lasts. A result within
  // REVEAL_MS clears the timer: the row was never ringed.
  useEffect(() => {
    if (live === undefined || revealed) return
    const t = setTimeout(
      () => setMemory(m => ({ ...m, revealed: true })),
      REVEAL_MS,
    )
    return () => clearTimeout(t)
  }, [live, revealed, setMemory])
  const { body } = view
  return (
    <div
      className={live === undefined ? "tool" : "tool live"}
      data-open={open || undefined}
      data-revealed={revealed || undefined}
      data-status={status}
      data-tool={call.name}
    >
      <span className="tool-head">
        {summary.tag !== undefined && (
          <span className="tool-tag">{summary.tag}</span>
        )}
        {mark !== undefined && <span className="tool-status">{mark}</span>}
        {live !== undefined && revealed && <Elapsed stream={live} />}
      </span>
      <div className="tool-command">
        <Runs runs={view.command} />
      </div>
      {body.kind === "images" ? (
        <div className="tool-images" data-thumb={body.thumb || undefined}>
          {body.images.map(image => (
            <StoredImage
              alt={call.subject ?? callLabel(call, "cut")}
              image={image}
              key={image.sha256}
              title={body.note}
            />
          ))}
        </div>
      ) : (
        body.text !== "" && <pre className="tool-output">{body.text}</pre>
      )}
      {view.more !== undefined && (
        <button
          aria-expanded={open}
          className="tool-more"
          onClick={() => setMemory(m => ({ ...m, open: !m.open }))}
          type="button"
        >
          {view.more}
        </button>
      )}
    </div>
  )
}

/**
 * How long a running call has run (`runningFor`), drawn once its row is
 * ringed, so a fast call never shows one. It redraws itself, not its row,
 * at each whole second the call has run.
 */
function Elapsed({ stream }: { stream: StreamId }) {
  const [now, setNow] = useState(Date.now)
  const ran = runningFor(stream, now)
  useEffect(() => {
    const next = runningFor(stream, now)?.next
    if (next === undefined) return
    const t = setTimeout(() => setNow(Date.now()), next)
    return () => clearTimeout(t)
  }, [stream, now])
  return ran === undefined ? null : (
    <span className="tool-elapsed">{ran.words}</span>
  )
}

/** A command's runs, each in a span its role colours (`.sh-*`); plain text bare. */
function Runs({ runs }: { runs: readonly Run[] }) {
  return runs.map((run, i) =>
    run.role === "plain" ? (
      run.text
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs are fixed for a call's view, and never reordered
      <span className={`sh-${run.role}`} key={i}>
        {run.text}
      </span>
    ),
  )
}

/**
 * A row's memory as state, which every change also writes to `rows`, in the
 * same call: a row unmounted at any moment has left its latest state there.
 * The setter takes an update of the latest value, read from a ref, so it
 * keeps its identity: the reveal timer's effect depends on it, and a click
 * within REVEAL_MS must not restart the timer.
 */
function useRemembered(
  rows: ScreenMemory<RowMemory>,
  id: string,
): [RowMemory, (update: (m: RowMemory) => RowMemory) => void] {
  const [memory, setState] = useState(() => rows.get(id) ?? NO_MEMORY)
  const current = useRef(memory)
  const set = useCallback(
    (update: (m: RowMemory) => RowMemory) => {
      const next = update(current.current)
      current.current = next
      rows.remember(id, next)
      setState(next)
    },
    [rows, id],
  )
  return [memory, set]
}
