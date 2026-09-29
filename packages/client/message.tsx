// client/message — one message in a column, and what can be done to it. It
// redraws only when `sameMessageProps` says what it shows changed, and reports
// what the reader asks as a `MessageAct`.

import { entryId, type ToolCallView } from "@pineta/core"
import { memo } from "react"
import { joinWords } from "./column-view.ts"
import { plural } from "./counts.ts"
import { type MessageProps, sameMessageProps } from "./message-props.ts"
import { MessageText } from "./message-text.tsx"
import type { MessageAct, MessageTools } from "./message-tools.ts"
import { speakerLabel, withContributors } from "./names.ts"
import { nameFor } from "./presence.tsx"
import { colorSlot, trackStyle } from "./rail.tsx"

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
          <ToolRow call={call} key={call.id} />
        ))}
        <Tools id={node.id} onAct={p.onAct} tools={p.tools} />
        {p.about}
        {p.origin}
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
 * One tool call: what it touched, whether it worked, and, folded, what it
 * returned. The result is its own entry in the tree, paired here by
 * `projectSpine`; with none yet, the call is still running or was cut off.
 */
function ToolRow({ call }: { call: ToolCallView }) {
  const status =
    call.result === undefined ? "pending" : call.result.isError ? "error" : "ok"
  const mark = status === "pending" ? "…" : status === "error" ? "✗" : "✓"
  const text = call.result?.text ?? ""
  return (
    <details className="tool" data-status={status} data-tool={call.name}>
      <summary>
        <span className="tool-label">{call.label}</span>{" "}
        <span className="tool-status">{mark}</span>
      </summary>
      {call.result !== undefined && (
        <pre className="tool-output">
          {text.length > SHOWN
            ? `${text.slice(0, SHOWN)}\n… ${text.length - SHOWN} more characters`
            : text}
        </pre>
      )}
    </details>
  )
}
