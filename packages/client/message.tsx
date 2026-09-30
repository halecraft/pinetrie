// client/message — one message in a column, and what can be done to it. It
// redraws only when `sameMessageProps` says what it shows changed, and reports
// what the reader asks as a `MessageAct`.

import { useSelector } from "@kyneta/react"
import { entryId, type ToolCallView } from "@pineta/core"
import { readStreamText, type SessionDocHandle } from "@pineta/schema"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { joinWords } from "./column-view.ts"
import { plural } from "./counts.ts"
import { type MessageProps, sameMessageProps } from "./message-props.ts"
import { MessageText } from "./message-text.tsx"
import type { MessageAct, MessageTools } from "./message-tools.ts"
import { speakerLabel, withContributors } from "./names.ts"
import { nameFor } from "./presence.tsx"
import { colorSlot, trackStyle } from "./rail.tsx"
import { click, REVEAL_MS, type ReaderChoice, rowSize } from "./tool-row.ts"
import { useFollow } from "./use-follow.ts"

function MessageView(p: MessageProps) {
  const { node } = p
  const speaker =
    node.role === "chat"
      ? withContributors(
          speakerLabel(p.nameOf, node.writer, node.author ?? ""),
          (node.contributors ?? []).map(w => nameFor(p.nameOf, w)),
        )
      : node.role === "assistant"
        ? "agent"
        : node.role === "land"
          ? "resolving your work"
          : node.role === "update"
            ? "your work"
            : node.role === "stack"
              ? "stack"
              : node.role
  const classes = [
    "msg",
    node.role,
    node.compelled === true ? "asked" : "",
  ].filter(c => c !== "")
  return (
    <>
      {p.join !== undefined && (
        <div className="lane-join" data-thread={p.join.name}>
          {joinWords(p.join)}
        </div>
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
            data-color={colorSlot(t)}
            data-track={t}
            key={t}
            onClick={e =>
              e.currentTarget
                .closest("#strip")
                ?.querySelector(`.column[data-track="${t}"]`)
                ?.scrollIntoView({ block: "nearest", inline: "nearest" })
            }
            style={trackStyle(t)}
            type="button"
          />
        ))}
        {/* A message that only called tools shows only its tool rows. */}
        {(node.text !== "" || node.toolCalls === undefined) && (
          <MessageText images={node.images} mode="committed" text={node.text} />
        )}
        {node.toolCalls?.map(call => (
          <ToolRow
            call={call}
            doc={p.doc}
            key={call.id}
            stream={p.streams[call.id]}
          />
        ))}
        <Tools id={node.id} onAct={p.onAct} tools={p.tools} />
        {p.about}
        {p.closedBranches.length > 0 && (
          <div className="actions">
            {p.closedBranches.map(b => (
              <button
                className="open-branch"
                key={b.rootId}
                onClick={() =>
                  p.onAct({ kind: "openBranch", rootId: b.rootId })
                }
                type="button"
              >
                ⑂ {plural(b.messageCount, "message")}
                {b.noteCount > 0 && ` · ${plural(b.noteCount, "note")}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * A message's tools, in one row that floats over its top right on hover or
 * focus: buttons under every message would drown the conversation. `→` comes
 * last, in the right margin, since what it opens appears to the right.
 */
export const Message = memo(MessageView, sameMessageProps)

function Tools({
  id,
  tools,
  onAct,
}: {
  id: string
  tools: MessageTools
  onAct: (act: MessageAct) => void
}) {
  const { edit, branch } = tools
  if (!tools.note && edit === undefined && branch === undefined) return null
  return (
    <div className="tools">
      {tools.note && (
        <button
          className="note-open"
          onClick={() => onAct({ kind: "note", entry: entryId(id) })}
          title="open a note on this message, for everyone"
          type="button"
        >
          note
        </button>
      )}
      {edit?.kind === "branch" && (
        <button
          className="edit"
          onClick={() => onAct({ kind: "branch", branch: edit })}
          title="edit and send again, in a branch beside this one"
          type="button"
        >
          edit
        </button>
      )}
      {edit?.kind === "newTab" && (
        <button
          className="edit-new-tab"
          onClick={() =>
            onAct({
              kind: "newTab",
              prefill: edit.prefill,
              asksAgent: edit.asksAgent,
            })
          }
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
          onClick={() => onAct({ kind: "branch", branch })}
          title="open a branch here"
          type="button"
        >
          →
        </button>
      )}
    </div>
  )
}

/** The most of a result a row shows; the whole of it is in the tree. */
const SHOWN = 20_000

/**
 * One tool call: what it touched, whether it worked, and what it returned. A
 * cut label (a long or multi-line command) is shown uncut in its place while
 * the row is open: CSS on `[open]` swaps the two, so the command is never
 * shown twice. The result is its own entry in the tree, paired here by
 * `projectSpine`; with none yet, the call is still running or was cut off.
 * How much is shown is `rowSize`'s: a call whose output streams for
 * `REVEAL_MS` opens its row, capped, and only the reader closes it.
 */
function ToolRow({
  call,
  stream,
  doc,
}: {
  call: ToolCallView
  stream: string | undefined
  doc: SessionDocHandle
}) {
  const status =
    call.result === undefined ? "pending" : call.result.isError ? "error" : "ok"
  const mark = status === "pending" ? "…" : status === "error" ? "✗" : "✓"
  // A result replaces the stream, whether or not the stream has gone yet.
  const live = call.result === undefined ? stream : undefined
  const [revealed, setRevealed] = useState(false)
  const [reader, setReader] = useState<ReaderChoice>(null)
  const size = rowSize({ revealed, reader })
  // Set once and never unset, so the row stays open when the result arrives.
  // A result within REVEAL_MS clears the timer: the row never opened.
  useEffect(() => {
    if (live === undefined || revealed) return
    const t = setTimeout(() => setRevealed(true), REVEAL_MS)
    return () => clearTimeout(t)
  }, [live, revealed])
  return (
    <details
      className={live === undefined ? "tool" : "tool live"}
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
          setReader(click(size))
        }}
      >
        <span className="tool-label">{call.label}</span>
        {call.wholeLabel !== undefined && (
          <span className="tool-label-whole">{call.wholeLabel}</span>
        )}{" "}
        <span className="tool-status">{mark}</span>
      </summary>
      {size !== "closed" && (
        <ToolOutput doc={doc} result={call.result?.text} stream={live} />
      )}
    </details>
  )
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
  doc: SessionDocHandle
  stream: string | undefined
  result: string | undefined
}) {
  const streamed = useSelector(
    doc,
    useCallback(
      (d: SessionDocHandle) =>
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
