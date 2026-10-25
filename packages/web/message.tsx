// web/message — one message in a column, and what can be done to it. It
// redraws only when `sameMessageProps` says what it shows changed, and reports
// what the reader asks as a `MessageAct`.

import { useSelector } from "@kyneta/react"
import {
  type BashOutputRecord,
  COMMENT,
  COPY_MESSAGE,
  callLabel,
  callMark,
  callStatus,
  canvasLines,
  canvasMarkerWords,
  canvasPinnedMarkerWords,
  copyText,
  type Density,
  joinWords,
  type MessageAct,
  type MessageTools,
  NO_MEMORY,
  type OutputRun,
  opens,
  pinnedMarkerWords,
  plural,
  REVEAL_MS,
  type RowMemory,
  type Run,
  retiredWords,
  rowLead,
  rowOutput,
  rowSummary,
  rowView,
  runningFor,
  type StatementStreams,
  showsText,
  speakerWords,
  toolBody,
} from "@pinetrie/interface"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import { newCardId } from "@pinetrie/session/connect"
import {
  isLineRole,
  type StreamId,
  type ToolCall,
  type TranscriptMessage,
  transcriptCalls,
} from "@pinetrie/threads"
import type { ScreenMemory } from "@pinetrie/web-core"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StoredImage } from "./blob-image.tsx"
import { Button, IconButton } from "./button.tsx"
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
  const person = node.role === "person" ? node : null
  const classes = [
    "msg",
    node.role,
    isLineRole(node.role) ? "host" : "",
    person?.compelled === true ? "asked" : "",
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
      {p.pinned?.canvasPinned !== undefined && (
        <details className="context-read canvas-pinned-read">
          <summary>{canvasPinnedMarkerWords(p.pinned.canvasPinned)}</summary>
          {p.pinned.canvasPinned.cards.map(c => (
            <div className="pinned-read-card" key={c.id}>
              <span className="pinned-read-by">{nameFor(p.nameOf, c.by)}</span>
              <div className="pinned-read-text">{c.text}</div>
            </div>
          ))}
          {p.pinned.canvasPinned.retired.map(r => (
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
      <div
        className={classes.join(" ")}
        data-entry={node.id}
        title={node.role === "fact" ? node.detail : undefined}
      >
        <span className="role">{speaker}</span>
        {p.crossCanvasLink !== undefined && (
          // Another canvas's thread it came from, opened as a fork row's link is;
          // in someone else's inventory, it opens nothing.
          <Button
            look="plain"
            className="cross-canvas-link"
            disabled={!opens(p.crossCanvasLink.link)}
            onClick={() =>
              p.crossCanvasLink !== undefined &&
              p.onLink(p.crossCanvasLink.link, node.id)
            }
            title="show that thread"
          >
            · {p.crossCanvasLink.words}
          </Button>
        )}
        {person?.command !== undefined && (
          <span
            className="command-label"
            title="a command: the agent read its skill or prompt"
          >
            /{person.command}
          </span>
        )}
        {p.forkTracks.map(t => (
          <IconButton
            label="show the branch that forks here"
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
          />
        ))}
        {showsText(node) && (
          <MessageText
            images={person?.images}
            mode="committed"
            shared={person?.shared}
            text={node.text}
          />
        )}
        {transcriptCalls(node).map(call => (
          <ToolRow
            call={call}
            density={p.density}
            doc={p.live}
            key={call.id}
            rows={p.rows}
            stream={p.streams[call.id]}
            statements={p.statementStreams[call.id]}
            stored={p.bashOutputs[call.id]}
          />
        ))}
        <Tools node={node} onAct={p.onAct} tools={p.tools} />
        {p.closedBranches.length > 0 && (
          <div className="actions">
            {p.closedBranches.map(b => (
              <Button
                look="outline"
                className="open-branch"
                key={b.rootId}
                onClick={() => p.onAct({ kind: "open-at", entry: b.rootId })}
              >
                ⑂ {plural(b.messageCount, "message")}
              </Button>
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
        <Button
          look="outline"
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
        >
          {COMMENT.label}
        </Button>
      )}
      {edit?.kind === "branch" && (
        <Button
          look="outline"
          className="edit"
          onClick={() => onAct(edit)}
          title="edit and send again, in a branch beside this one"
        >
          edit
        </Button>
      )}
      {edit?.kind === "new-canvas" && (
        <Button
          look="outline"
          className="edit-new-canvas"
          onClick={() => onAct(edit)}
          title="a new canvas starting with this message's text"
        >
          new canvas
        </Button>
      )}
      {branch !== undefined && (
        <IconButton
          look="outline"
          label="open a branch here"
          className="branch"
          onClick={() => onAct(branch)}
        >
          →
        </IconButton>
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
    <IconButton
      look="outline"
      label={COPY_MESSAGE}
      className="copy"
      onClick={e =>
        copy(copyText(node), [
          ...(e.currentTarget
            .closest(".msg")
            ?.querySelectorAll(":scope > .text, :scope > .tool") ?? []),
        ])
      }
      title={copied ? COPIED : COPY_MESSAGE}
    >
      {copied ? "✓" : <CopyIcon />}
    </IconButton>
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
 * (`toolBody`), which keeps to their `title`. A `bash` call whose output
 * verified by statement shows, in its detail, each statement's under its
 * lines: its live statement streams while it runs, its stored record once
 * it has a result. What it decided is kept in `rows` by the call's id, so a
 * row mounted again starts where it was left.
 */
function ToolRow({
  call,
  stream,
  statements,
  stored,
  doc,
  rows,
  density,
}: {
  call: ToolCall
  stream: StreamId | undefined
  /** Its statements' live streams, by ordinal, while it runs. */
  statements: StatementStreams | undefined
  /** How its output reads, stored once it returned. */
  stored: BashOutputRecord | undefined
  doc: LiveDocHandle
  rows: ScreenMemory<RowMemory>
  /** The column's density: in story a call leads with its intent (`rowLead`). */
  density: Density
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
  const ordinals = useMemo(
    () =>
      live === undefined || statements === undefined
        ? []
        : Object.keys(statements)
            .map(Number)
            .sort((a, b) => a - b),
    [live, statements],
  )
  // One string, so the selector's value compares equal while no text changes.
  const liveTexts = useSelector(
    doc,
    useCallback(
      (d: LiveDocHandle) =>
        JSON.stringify(
          ordinals.map(n => {
            const id = statements?.[n]
            return id === undefined ? "" : readStreamText(d, id)
          }),
        ),
      [ordinals, statements],
    ),
  )
  const output = useMemo(() => {
    const texts = JSON.parse(liveTexts) as string[]
    return rowOutput(
      call,
      streamed,
      stored,
      Object.fromEntries(ordinals.map((n, i) => [n, texts[i] ?? ""])),
      summary.statements.length,
    )
  }, [call, streamed, stored, liveTexts, ordinals, summary])
  const view = rowView(
    summary,
    rowLead(summary, density),
    output,
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
      {view.head !== null && <div className="tool-intent">{view.head}</div>}
      {view.command.length > 0 && (
        <div className="tool-command">
          {view.command.map((line, i) => (
            <div
              className="tool-line"
              data-starts={line.startsStatement || undefined}
              // biome-ignore lint/suspicious/noArrayIndexKey: a call's lines are fixed for its view, and never reordered
              key={i}
            >
              <Runs runs={line.runs} />
              {line.outputs.map((runs, j) => (
                <pre
                  className="tool-output tool-statement-output"
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line's outputs are its statements', in order
                  key={j}
                >
                  <OutputRuns runs={runs} />
                </pre>
              ))}
            </div>
          ))}
        </div>
      )}
      {view.caption !== null && (
        <div className="tool-caption">{view.caption}</div>
      )}
      {view.undividedNote !== null && (
        <div className="tool-undivided">{view.undividedNote}</div>
      )}
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
        body.runs.length > 0 && (
          <pre className="tool-output">
            <OutputRuns runs={body.runs} />
          </pre>
        )
      )}
      {view.more !== undefined && (
        <Button
          look="plain"
          aria-expanded={open}
          className="tool-more"
          onClick={() => setMemory(m => ({ ...m, open: !m.open }))}
        >
          {view.more}
        </Button>
      )}
    </div>
  )
}

/** A command's output, what it wrote to stderr drawn apart. */
function OutputRuns({ runs }: { runs: readonly OutputRun[] }) {
  return runs.map((run, i) =>
    run.stderr ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: a view's runs are fixed for it, and never reordered
      <span className="tool-stderr" key={i}>
        {run.text}
      </span>
    ) : (
      run.text
    ),
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
