// client/message — one message in a column, and what can be done to it.

import type { ReferenceTarget, SpineNode, ToolCallView } from "@pineta/core"
import { entryId } from "@pineta/core"
import type { Reference } from "@pineta/marginalia"
import { speakerLabel } from "./names.ts"
import { colorSlot, trackColor } from "./rail.tsx"

export interface MessageProps {
  node: SpineNode
  /** Current display names, by writer. */
  nameOf: ReadonlyMap<string, string>
  /** While the agent replies: whether it reads this message. */
  light: "lit" | "dim" | undefined
  /** The agent joins the thread here: the first message on the path that asked it. */
  joined: boolean
  /** Tracks of open columns that fork here: a dot of each colour. */
  forkTracks: readonly number[]
  /** Branches leaving here that no column shows. */
  closedBranches: readonly {
    readonly rootId: string
    readonly messageCount: number
  }[]
  cites: readonly Reference[]
  citedBy: readonly Reference[]
  onCite: (to: ReferenceTarget) => void
  /**
   * Open a column to the right, forked here (ADR-0021). Undefined where it
   * would only mean replying: a conversation's last message.
   */
  onBranch: { readonly title: string; readonly go: () => void } | undefined
  onOpenBranch: (rootId: string) => void
}

export function Message(p: MessageProps) {
  const { node } = p
  const id = entryId(node.id)
  const speaker =
    node.role === "chat"
      ? speakerLabel(p.nameOf, node.writer, node.author ?? "")
      : node.role === "assistant"
        ? "agent"
        : node.role
  const classes = [
    "msg",
    node.role,
    node.compelled === true ? "asked" : "",
    p.light ?? "",
  ].filter(c => c !== "")
  return (
    <>
      {p.joined && (
        <div className="joined">agent joined · it reads this thread</div>
      )}
      <div className={classes.join(" ")} data-entry={node.id}>
        <span className="role">{speaker}</span>
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
            style={{ background: trackColor(t) }}
            type="button"
          />
        ))}
        {/* JSX escapes by default, so model output is never HTML. A message
            that only called tools shows only its tool rows. */}
        {(node.text !== "" || node.toolCalls === undefined) && (
          <div className="text">{node.text}</div>
        )}
        {node.toolCalls?.map(call => (
          <ToolRow call={call} key={call.id} />
        ))}
        {/* In the right margin, because what it opens appears to the right. */}
        {p.onBranch !== undefined && (
          <button
            aria-label={p.onBranch.title}
            className="branch"
            onClick={p.onBranch.go}
            title={p.onBranch.title}
            type="button"
          >
            →
          </button>
        )}
        {/* Tools float over the message on hover or focus: every message has
            them, and buttons under each would drown the conversation. */}
        <div className="tools">
          <button
            className="cite"
            // Keep the text selection alive through the click.
            onClick={e => {
              const text = e.currentTarget
                .closest(".msg")
                ?.querySelector(".text")
              const span = text ? selectedSpan(text) : null
              p.onCite(
                span === null
                  ? { kind: "entry", id }
                  : { kind: "span", id, ...span },
              )
            }}
            onMouseDown={e => e.preventDefault()}
            type="button"
          >
            cite
          </button>
        </div>
        {(p.closedBranches.length > 0 ||
          p.cites.length > 0 ||
          p.citedBy.length > 0) && (
          <div className="actions">
            {p.closedBranches.map(b => (
              <button
                className="open-branch"
                key={b.rootId}
                onClick={() => p.onOpenBranch(b.rootId)}
                type="button"
              >
                ⑂ {b.messageCount} message{b.messageCount === 1 ? "" : "s"}
              </button>
            ))}
            {p.cites.length > 0 && (
              <span className="cites" data-cites={p.cites.length}>
                ↗ cites {p.cites.length}
              </span>
            )}
            {p.citedBy.length > 0 && (
              <span
                className="cited-by"
                data-cited-by={p.citedBy.length}
                title={p.citedBy.map(r => r.author).join(", ")}
              >
                ↙ cited by {p.citedBy.length}
              </span>
            )}
          </div>
        )}
      </div>
    </>
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

/**
 * The selection inside `text`, as UTF-16 offsets into its rendered string, or
 * null if nothing inside it is selected. The element renders exactly
 * `entryText`, so these are the offsets a span reference means.
 */
function selectedSpan(text: Element): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0)
    return null
  const range = selection.getRangeAt(0)
  if (
    !text.contains(range.startContainer) ||
    !text.contains(range.endContainer)
  )
    return null
  const before = document.createRange()
  before.selectNodeContents(text)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const end = start + range.toString().length
  return end > start ? { start, end } : null
}
