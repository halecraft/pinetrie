// client/message-tools — which tools a message offers, as a pure rule: copy,
// note, edit (or new tab), and `→` (ADR-0021, ADR-0025, ADR-0043). `Column` gathers
// the facts, and `Message` draws the result. What a reader then asks of the
// message is a `MessageAct`, which `Column` carries out.

import {
  type EntryId,
  parseMentions,
  THE_AGENT,
  type ThreadLane,
  type TranscriptMessage,
} from "@pineta/core"
import type { Prefill } from "./columns.ts"

/** The mention that asks the agent, as a composer starts with it. */
const AGENT_PREFIX = `@${THE_AGENT} `

/** `@agent ` as a box starts with it: the one blank prefill, nothing typed. */
export const AGENT_PREFILL: Prefill = { text: AGENT_PREFIX, blank: true }

/** A fresh column to open: a branch at `at`. */
export interface OpenBranch {
  readonly at: string
  readonly prefill: Prefill | undefined
}

export type MessageEdit =
  | ({ readonly kind: "branch" } & OpenBranch)
  | {
      readonly kind: "newTab"
      readonly asksAgent: boolean
      readonly prefill: Prefill
    }

export interface MessageTools {
  /**
   * What copy puts on the clipboard: the message's markdown, as stored. None
   * for a message that only called tools.
   */
  readonly copy: string | undefined
  /** Open a note about it. */
  readonly note: boolean
  readonly edit: MessageEdit | undefined
  /** `→`: a branch at the message. */
  readonly branch: OpenBranch | undefined
}

/**
 * What a branch's composer starts with: `@agent ` in agent work, so going on
 * with the agent is already typed, and deleting it makes the branch a
 * conversation (ADR-0021). Nothing in a conversation.
 */
export const branchPrefill = (lane: ThreadLane): Prefill | undefined =>
  lane.kind === "lane" ? AGENT_PREFILL : undefined

/** What a reader asked of a message. `Column` carries it out. */
export type MessageAct =
  | { readonly kind: "note"; readonly entry: EntryId }
  | { readonly kind: "branch"; readonly branch: OpenBranch }
  | {
      readonly kind: "newTab"
      readonly prefill: Prefill
      readonly asksAgent: boolean
    }
  | { readonly kind: "openBranch"; readonly rootId: string }

export function messageTools(
  node: TranscriptMessage,
  at: {
    readonly parentId: string | null
    /** The column's last message. */
    readonly isLast: boolean
    /** The column's thread. */
    readonly lane: ThreadLane
    readonly writable: boolean
    readonly hasNoteAbout: boolean
  },
): MessageTools {
  // Copying only reads, so a column that can't be written offers it too.
  const copy = node.text === "" ? undefined : node.text
  if (!at.writable)
    return { copy, note: false, edit: undefined, branch: undefined }
  return {
    copy,
    note: !at.hasNoteAbout,
    edit: node.role === "chat" ? editOf(node, at.parentId) : undefined,
    // Below a conversation's last message, a branch would be the same as
    // replying. Agent work follows its lane, so there a branch at the end is
    // a thread of its own.
    branch:
      at.isLast && at.lane.kind !== "lane"
        ? undefined
        : { at: node.id, prefill: branchPrefill(at.lane) },
  }
}

/**
 * A person's message sent again, changed or not: a sibling at its parent, or,
 * for a root's first message, a new tab. It asks the agent exactly when the
 * original did. A branch asks only through a mention (`agentByDefault`), so a
 * message its thread's default compelled gets `@agent ` in front.
 */
function editOf(node: TranscriptMessage, parentId: string | null): MessageEdit {
  const compelled = node.compelled === true
  if (parentId === null)
    return {
      kind: "newTab",
      asksAgent: compelled,
      prefill: { text: node.text, blank: false },
    }
  const named = parseMentions(node.text).some(m => m.kind === "agent")
  return {
    kind: "branch",
    at: parentId,
    prefill: {
      text: compelled && !named ? `${AGENT_PREFIX}${node.text}` : node.text,
      blank: false,
    },
  }
}
