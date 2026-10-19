// interface/message-tools — which tools a message offers: copy, comment, edit
// (or new canvas), and `→`. Nothing is taken from the past: a message is copied,
// and kept from the clipboard cell. `Column` gathers the facts, and `Message`
// draws the result. Each tool but copy is the `MessageAct` it sends, which
// reaches `App` as its column's intent (`intent.ts`).

import { agentAsk, type EntryId, type ThreadId } from "@pinetrie/core"
import {
  type Address,
  type BlockRef,
  parseMentions,
  type TextCardId,
  type ThreadLane,
  type TranscriptMessage,
  transcriptCalls,
} from "@pinetrie/threads"
import type { Taken } from "./clip.ts"
import type { Prefill } from "./columns.ts"
import { addressMarkdown } from "./markdown-of.ts"

/** The mention that asks the agent, as a composer starts with it. */
const AGENT_PREFIX = agentAsk("")

/** `@agent ` as a box starts with it: the one blank prefill, nothing typed. */
export const AGENT_PREFILL: Prefill = { text: AGENT_PREFIX, blank: true }

interface OpenBranch {
  readonly at: EntryId
  readonly prefill: Prefill | undefined
}

/** Each tool a message offers, as the act it sends; undefined when not offered. */
export interface MessageTools {
  /**
   * Copy its text and tool calls: it has one or the other. What is copied is
   * built on a press (`copyText`), not here, or every build of a column's
   * list would join every call's output.
   */
  readonly copy: boolean
  /** Comment on it: a note in its margin, where the column can be written. */
  readonly comment: boolean
  /** Send it again: a sibling at its parent, or a root's first message on a new canvas. */
  readonly edit:
    | Extract<MessageAct, { kind: "branch" | "new-canvas" }>
    | undefined
  /** `→`: a branch at the message. */
  readonly branch: Extract<MessageAct, { kind: "branch" }> | undefined
}

/**
 * What a branch's composer starts with: `@agent ` in an agent thread, so going
 * on with the agent is already typed, and deleting it makes the branch a chat.
 * Nothing in a chat.
 */
export const branchPrefill = (lane: ThreadLane): Prefill | undefined =>
  lane.kind === "lane" ? AGENT_PREFILL : undefined

/** What a reader asked of a message. */
export type MessageAct =
  | { readonly kind: "branch"; readonly branch: OpenBranch }
  | { readonly kind: "new-canvas"; readonly prefill: Prefill }
  /** Show an entry: a closed branch's first message. */
  | { readonly kind: "open-at"; readonly entry: EntryId }
  /**
   * Comment on the message `entry`, in `thread`: a new, empty note `card`
   * in its margin.
   */
  | {
      readonly kind: "comment"
      readonly card: TextCardId
      readonly entry: EntryId
      readonly thread: ThreadId
    }

export function messageTools(
  node: TranscriptMessage,
  at: {
    readonly parentId: EntryId | null
    /** The column's last message. */
    readonly isLast: boolean
    /** The column's thread. */
    readonly lane: ThreadLane
    readonly writable: boolean
  },
): MessageTools {
  // Copying only reads, so a column that can't be written proposed changes it
  // too.
  const copy = node.text !== "" || transcriptCalls(node).length > 0
  if (!at.writable)
    return {
      copy,
      comment: false,
      edit: undefined,
      branch: undefined,
    }
  return {
    copy,
    comment: true,
    edit: node.role === "person" ? editOf(node, at.parentId) : undefined,
    // Below a chat's last message, a branch would be the same as
    // replying. An agent thread follows its lane, so there a branch at the end is
    // a thread of its own.
    branch:
      at.isLast && at.lane.kind !== "lane"
        ? undefined
        : {
            kind: "branch",
            branch: { at: node.id, prefill: branchPrefill(at.lane) },
          },
  }
}

/**
 * A person's message sent again, changed or not: a sibling at its parent, or,
 * for a root's first message, a new canvas. It asks the agent exactly when the
 * original did. A branch or a new canvas asks only through a mention
 * (`agentByDefault`), so a message its thread's default compelled gets
 * `@agent ` in front.
 */
function editOf(
  node: TranscriptMessage,
  parentId: EntryId | null,
): MessageTools["edit"] {
  const named = parseMentions(node.text).some(m => m.kind === "agent")
  const prefill = {
    text:
      node.role === "person" && node.compelled && !named
        ? `${AGENT_PREFIX}${node.text}`
        : node.text,
    blank: false,
  }
  return parentId === null
    ? { kind: "new-canvas", prefill }
    : { kind: "branch", branch: { at: parentId, prefill } }
}

/**
 * What taking `node` takes: the block named (a table's bar, an image), else the
 * whole message.
 */
export function messageReference(
  node: TranscriptMessage,
  block: BlockRef | null,
): Taken {
  const at = { thread: node.thread, entry: node.id }
  return takenAt(
    node,
    block === null ? { kind: "entry", ...at } : { kind: "block", ...at, block },
  )
}

/**
 * What taking your selection in `node` takes: a range of the message's text
 * when the selection's text is in it as written. Null otherwise, as when the
 * selection crosses formatting, whose drawn text is not its markdown: the
 * selection is no part of the message a range can name, and the whole message
 * is not what you selected.
 */
export function selectionReference(
  node: TranscriptMessage,
  text: string,
): Taken | null {
  const from = text.trim() === "" ? -1 : node.text.indexOf(text)
  if (from < 0) return null
  return takenAt(node, {
    kind: "range",
    thread: node.thread,
    entry: node.id,
    from,
    to: from + text.length,
  })
}

/** `address` in `node` taken: its markdown `addressMarkdown`'s, so a reference's quote and the clipboard say the same. */
const takenAt = (node: TranscriptMessage, address: Address): Taken => ({
  address,
  markdown: addressMarkdown(address, {
    messageOf: entry => (entry === node.id ? node : undefined),
  }),
})

/**
 * Whether a message draws its own text: a message that only called tools
 * shows only its tool rows.
 */
export const showsText = (node: TranscriptMessage): boolean =>
  node.text !== "" || transcriptCalls(node).length === 0
