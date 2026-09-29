// client/message — one message in a column, and what can be done to it.

import type {
  BranchSummary,
  SpineNode,
  ToolCallView,
  WriterId,
} from "@pineta/core"
import type { ReactNode } from "react"
import { joinWords, type LaneJoin } from "./column-view.ts"
import type { Prefill } from "./columns.ts"
import { plural } from "./counts.ts"
import { MessageText } from "./message-text.tsx"
import type { MessageTools, OpenBranch } from "./message-tools.ts"
import { speakerLabel, withContributors } from "./names.ts"
import { nameFor } from "./presence.tsx"
import { colorSlot, trackStyle } from "./rail.tsx"

export interface MessageProps {
  node: SpineNode
  /** Current display names, by writer. */
  nameOf: ReadonlyMap<WriterId, string>
  /** Its note's card (ADR-0025), drawn below it. */
  about: ReactNode | undefined
  /** The card of the note it was sent from, drawn below it once changed. */
  origin: ReactNode | undefined
  /** Which tools it offers (`messageTools`). */
  tools: MessageTools
  /** Open a note about it. */
  onNote: () => void
  /** Open a fresh column to the right: `→`, or an edit (ADR-0021). */
  onBranch: (branch: OpenBranch) => void
  /** Open a new tab: a root's first message, edited. */
  onNewTab: (prefill: Prefill, asksAgent: boolean) => void
  /** A lane starts here: a divider above the message names it. */
  join: LaneJoin | undefined
  /** Tracks of open columns that fork here: a dot of each colour. */
  forkTracks: readonly number[]
  /** Branches leaving here that no column shows. */
  closedBranches: readonly BranchSummary[]
  onOpenBranch: (rootId: string) => void
}

export function Message(p: MessageProps) {
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
        <Tools {...p} />
        {p.about}
        {p.origin}
        {p.closedBranches.length > 0 && (
          <div className="actions">
            {p.closedBranches.map(b => (
              <button
                className="open-branch"
                key={b.rootId}
                onClick={() => p.onOpenBranch(b.rootId)}
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
function Tools({ tools, onNote, onBranch, onNewTab }: MessageProps) {
  const { edit, branch } = tools
  if (!tools.note && edit === undefined && branch === undefined) return null
  return (
    <div className="tools">
      {tools.note && (
        <button
          className="note-open"
          onClick={onNote}
          title="open a note on this message, for everyone"
          type="button"
        >
          note
        </button>
      )}
      {edit?.kind === "branch" && (
        <button
          className="edit"
          onClick={() => onBranch(edit)}
          title="edit and send again, in a branch beside this one"
          type="button"
        >
          edit
        </button>
      )}
      {edit?.kind === "newTab" && (
        <button
          className="edit-new-tab"
          onClick={() => onNewTab(edit.prefill, edit.asksAgent)}
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
          onClick={() => onBranch(branch)}
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
