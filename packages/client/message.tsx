// client/message — one message in a column, and what can be done to it.

import type { ReferenceTarget, Responder, SpineNode } from "@pineta/core"
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
  /** The rule set AT this message, if one is: a marker is drawn after it. */
  ruleSet: Responder | undefined
  /** The rule in force at this message, for the action that changes it. */
  ruleHere: Responder
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
  /** Undefined on a column's last message: replying there is the composer's job. */
  onBranchHere: (() => void) | undefined
  onOpenBranch: (rootId: string) => void
  onSetRule: (mode: "session" | "conversation") => void
}

const ruleText = (r: Responder) =>
  r.kind === "agent"
    ? "from here, the agent replies to every message"
    : "from here, the agent replies only when @agent is mentioned"

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
        {/* JSX escapes by default, so model output is never HTML. */}
        <div className="text">{node.text}</div>
        {/* Tools float over the message on hover or focus: every message has
            them, and three buttons under each would drown the conversation. */}
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
          {p.onBranchHere !== undefined && (
            <button
              className="branch-here"
              onClick={p.onBranchHere}
              type="button"
            >
              branch from here
            </button>
          )}
          <button
            className="rule"
            onClick={() =>
              p.onSetRule(
                p.ruleHere.kind === "agent" ? "conversation" : "session",
              )
            }
            // The label is what clicking DOES, as a verb; the rule in force now
            // is the tooltip. A label that reads like a state would contradict
            // the composer, which states the rule in force.
            title={
              p.ruleHere.kind === "agent"
                ? "Now: the agent replies to every message here."
                : "Now: the agent replies only when @agent is mentioned."
            }
            type="button"
          >
            {p.ruleHere.kind === "agent"
              ? "from here, only answer @agent"
              : "from here, answer every message"}
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
      {p.ruleSet !== undefined && (
        <div className="rule-marker" data-rule={p.ruleSet.kind}>
          {ruleText(p.ruleSet)}
        </div>
      )}
    </>
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
