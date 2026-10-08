// web/message — one message in a column, and what can be done to it. It
// redraws only when `sameMessageProps` says what it shows changed, and reports
// what the reader asks as a `MessageAct`.

import { useSelector } from "@kyneta/react"
import type { StreamId, ToolCall, TranscriptMessage } from "@pinetrie/core"
import {
  CALL_MARK,
  callLabel,
  callStatus,
  click,
  copyIntoInventoryText,
  copyText,
  joinWords,
  type MessageAct,
  type MessageTools,
  NO_MEMORY,
  pinnedMarkerWords,
  plural,
  REVEAL_MS,
  type RowMemory,
  type Run,
  retiredWords,
  rowSize,
  rowSummary,
  type ScreenMemory,
  showsText,
  speakerLabel,
  TAKE_COPY_INTO_INVENTORY,
  TAKE_INTO_INVENTORY,
  toolBody,
  withContributors,
} from "@pinetrie/interface"
import { type LiveDocHandle, readStreamText } from "@pinetrie/schema"
import { newCardId } from "@pinetrie/session"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StoredImage } from "./blob-image.tsx"
import { COPIED, useCopy } from "./copy.ts"
import { type MessageProps, sameMessageProps } from "./message-props.ts"
import { MessageText } from "./message-text.tsx"
import { useTrackColors } from "./palette-context.ts"
import { MessageSource } from "./pane-context.ts"
import { nameFor } from "./presence.tsx"
import { useFollow } from "./use-follow.ts"

/** What a message's role is called above it, where it is not its own name. */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  assistant: "agent",
  land: "catching up",
  update: "caught up",
  "carry-on": "resumed",
  fact: "offer",
  behind: "the base",
}

function MessageView(p: MessageProps) {
  const { node } = p
  const colors = useTrackColors()
  const speaker =
    node.role === "chat"
      ? withContributors(
          speakerLabel(p.nameOf, node.writer, node.author ?? ""),
          (node.contributors ?? []).map(w => nameFor(p.nameOf, w)),
        )
      : (ROLE_LABEL[node.role] ?? node.role)
  const classes = [
    "msg",
    node.role,
    node.compelled === true ? "asked" : "",
  ].filter(c => c !== "")
  // What its tables and images name it by, in the column's pane (ADR-0078).
  const source = useMemo<MessageSource>(
    () => ({ kind: "entry", entry: node.id }),
    [node.id],
  )
  return (
    <MessageSource value={source}>
      {p.join !== undefined && (
        <div className="lane-join" data-thread={p.join.name}>
          {joinWords(p.join)}
        </div>
      )}
      {p.pinned !== undefined && (
        <details className="pinned-read">
          <summary>{pinnedMarkerWords(p.pinned)}</summary>
          {p.pinned.cards.map(c => (
            <div className="pinned-read-card" key={c.id}>
              <span className="pinned-read-by">{nameFor(p.nameOf, c.by)}</span>
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
          <MessageText images={node.images} mode="committed" text={node.text} />
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
  if (!tools.copy && edit === undefined && branch === undefined) return null
  return (
    <div className="tools">
      {tools.copy && <CopyButton node={node} />}
      {tools.takeCopyIntoInventory && (
        <button
          aria-label={TAKE_COPY_INTO_INVENTORY}
          className="take-copy-into-inventory"
          onClick={e => {
            const msg = e.currentTarget.closest(".msg")
            const selection = window.getSelection()
            const range =
              selection === null || selection.rangeCount === 0
                ? null
                : selection.getRangeAt(0)
            onAct({
              kind: "takeCopyIntoInventory",
              card: newCardId(),
              text: copyIntoInventoryText(
                node,
                range === null || selection === null
                  ? null
                  : {
                      text: selection.toString(),
                      inside:
                        msg?.contains(range.commonAncestorContainer) === true,
                    },
              ),
            })
          }}
          title={TAKE_COPY_INTO_INVENTORY}
          type="button"
        >
          {TAKE_INTO_INVENTORY}
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

/** Two overlapping sheets, 1em square, drawn in the text's colour. */
function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1em"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="1em"
    >
      <rect height="9" rx="1.5" width="9" x="5.5" y="5.5" />
      <path d="M10.5 3V2.5A1.5 1.5 0 0 0 9 1H2.5A1.5 1.5 0 0 0 1 2.5V9a1.5 1.5 0 0 0 1.5 1.5H3" />
    </svg>
  )
}

/** The most of a result a row shows; the whole of it is in the tree. */
const SHOWN = 20_000

/**
 * One tool call: its tool's word as a tag, what it touched, whether it
 * worked, and what it returned (`rowSummary`, ADR-0114). What it touched is
 * previewed closed and shown whole open (a command laid out a step a line):
 * CSS on `[open]` swaps the two, so it is never shown twice. The result is its own entry in the tree, paired here by
 * `projectSpine`; with none yet, the call is still running or was cut off.
 * How much is shown is `rowSize`'s: a call whose output streams for
 * `REVEAL_MS`, or whose result has an image, opens its row, capped, and only
 * the reader closes it. A result's images are drawn in place of its text
 * (`toolBody`), which keeps to their `title`. What it decided is kept in
 * `rows` by the call's id, so a row mounted again starts where it was left.
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
  const mark = CALL_MARK[status]
  // A result replaces the stream, whether or not the stream has gone yet.
  const live = call.result === undefined ? stream : undefined
  const [memory, setMemory] = useRemembered(rows, call.id)
  const { revealed } = memory
  const body = toolBody(call.result)
  const summary = useMemo(() => rowSummary(call), [call])
  const size = rowSize({ ...memory, shows: body.kind === "images" })
  // Set once and never unset, so the row stays open when the result arrives.
  // A result within REVEAL_MS clears the timer: the row never opened.
  useEffect(() => {
    if (live === undefined || revealed) return
    const t = setTimeout(
      () => setMemory(m => ({ ...m, revealed: true })),
      REVEAL_MS,
    )
    return () => clearTimeout(t)
  }, [live, revealed, setMemory])
  return (
    <details
      className={live === undefined ? "tool" : "tool live"}
      data-revealed={revealed || undefined}
      data-size={size}
      data-status={status}
      data-tool={call.name}
      open={size !== "closed"}
    >
      {/* The row's size is state, not the element's: a native toggle would
        close a capped row, where a click shows it whole. Enter and Space on a
        summary are clicks too. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a summary is its details' own toggle, focusable and keyboard-operable */}
      <summary
        onClick={e => {
          e.preventDefault()
          setMemory(m => ({ ...m, reader: click(size) }))
        }}
      >
        {summary.tag !== undefined && (
          <span className="tool-tag">{summary.tag}</span>
        )}
        <span className="tool-label">
          <Runs runs={summary.preview} />
        </span>
        {summary.whole !== undefined && (
          <span className="tool-label-whole">
            <Runs runs={summary.whole} />
          </span>
        )}{" "}
        <span className="tool-status">{mark}</span>
      </summary>
      {size === "closed" ? null : body.kind === "images" ? (
        <div className="tool-images">
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
        <ToolOutput doc={doc} result={call.result?.text} stream={live} />
      )}
    </details>
  )
}

/** A summary's runs, each in a span its role colours (`.sh-*`); plain text bare. */
function Runs({ runs }: { runs: readonly Run[] }) {
  return runs.map((run, i) =>
    run.role === "plain" ? (
      run.text
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs are fixed for a call, and never reordered
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

/**
 * A call's output: its result, or while it has none, its stream. One element
 * for both, so the handover keeps its scroll and its follow: a capped row
 * shows the result's end, where the live output was.
 */
function ToolOutput({
  doc,
  stream,
  result,
}: {
  doc: LiveDocHandle
  stream: StreamId | undefined
  result: string | undefined
}) {
  const streamed = useSelector(
    doc,
    useCallback(
      (d: LiveDocHandle) =>
        stream === undefined ? "" : readStreamText(d, stream),
      [stream],
    ),
  )
  const text =
    result === undefined
      ? streamed
      : result.length > SHOWN
        ? `${result.slice(0, SHOWN)}\n… ${result.length - SHOWN} more characters`
        : result
  const pre = useRef<HTMLPreElement>(null)
  const inner = useRef<HTMLElement>(null)
  useFollow(pre, inner)
  return (
    <pre className="tool-output" ref={pre}>
      <code className="tool-output-text" ref={inner}>
        {text}
      </code>
    </pre>
  )
}
