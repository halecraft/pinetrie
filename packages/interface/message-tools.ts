// interface/message-tools — which tools a message offers, as a pure rule: copy,
// edit (or new tab), and `→` (ADR-0021, ADR-0043). `Column`
// gathers the facts, and `Message` draws the result. Each tool but copy is the
// `MessageAct` it sends, which reaches `App` as its column's intent
// (`intent.ts`).

import {
  type Address,
  type BlockRef,
  type EntryId,
  parseMentions,
  type ReferenceCardId,
  THE_AGENT,
  type ThreadLane,
  type TranscriptMessage,
} from "@pinetrie/core"
import type { Taken } from "./card-intents.ts"
import type { Prefill } from "./columns.ts"
import { markdownOf } from "./markdown-of.ts"

/** The mention that asks the agent, as a composer starts with it. */
const AGENT_PREFIX = `@${THE_AGENT} `

/** `@agent ` as a box starts with it: the one blank prefill, nothing typed. */
export const AGENT_PREFILL: Prefill = { text: AGENT_PREFIX, blank: true }

/** A fresh column to open: a branch at `at`. */
export interface OpenBranch {
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
  /**
   * Take a reference into your inventory (ADR-0126): what copy offers, where
   * the column can be written. Built on a press too (`referenceOf`).
   */
  readonly takeReference: boolean
  /** Send it again: a sibling at its parent, or a root's first message in a new tab. */
  readonly edit: Extract<MessageAct, { kind: "branch" | "newTab" }> | undefined
  /** `→`: a branch at the message. */
  readonly branch: Extract<MessageAct, { kind: "branch" }> | undefined
}

/**
 * What a branch's composer starts with: `@agent ` in agent work, so going on
 * with the agent is already typed, and deleting it makes the branch a
 * conversation (ADR-0021). Nothing in a conversation.
 */
export const branchPrefill = (lane: ThreadLane): Prefill | undefined =>
  lane.kind === "lane" ? AGENT_PREFILL : undefined

/** What a reader asked of a message. */
export type MessageAct =
  | { readonly kind: "branch"; readonly branch: OpenBranch }
  | {
      readonly kind: "newTab"
      readonly prefill: Prefill
      readonly asksAgent: boolean
    }
  /** Show an entry: a closed branch's first message. */
  | { readonly kind: "openAt"; readonly entry: EntryId }
  /**
   * Take a reference to the message, a block of it or your selection in it
   * into your inventory as a new card, `card` (ADR-0126: a reference to the
   * past is the copy), its markdown on the clipboard too.
   */
  | ({
      readonly kind: "takeReference"
      readonly card: ReferenceCardId
    } & Taken)

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
  // Copying only reads, so a column that can't be written offers it too.
  const copy = node.text !== "" || (node.toolCalls?.length ?? 0) > 0
  if (!at.writable)
    return {
      copy,
      takeReference: false,
      edit: undefined,
      branch: undefined,
    }
  return {
    copy,
    takeReference: copy,
    edit: node.role === "chat" ? editOf(node, at.parentId) : undefined,
    // Below a conversation's last message, a branch would be the same as
    // replying. Agent work follows its lane, so there a branch at the end is
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
 * for a root's first message, a new tab. It asks the agent exactly when the
 * original did. A branch asks only through a mention (`agentByDefault`), so a
 * message its thread's default compelled gets `@agent ` in front.
 */
function editOf(
  node: TranscriptMessage,
  parentId: EntryId | null,
): MessageTools["edit"] {
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
    branch: {
      at: parentId,
      prefill: {
        text: compelled && !named ? `${AGENT_PREFIX}${node.text}` : node.text,
        blank: false,
      },
    },
  }
}

/** The page's selection as a take reads it: its text, and whether it lies within the message. */
export interface SelectionLike {
  readonly text: string
  readonly inside: boolean
}

/**
 * What taking from `node` takes (ADR-0126): a block of it when one is named
 * (a table's bar, an image); else your selection when it lies within the
 * message and its text is in the message's text as written, a range of it;
 * else the whole message. Its markdown is `markdownOf`'s, so a reference's
 * quote and the clipboard say the same. Pure.
 */
export function referenceOf(
  node: TranscriptMessage,
  selection: SelectionLike | null,
  block: BlockRef | null,
): Taken {
  const at = { thread: node.thread, entry: node.id }
  const from =
    selection?.inside === true && selection.text.trim() !== ""
      ? node.text.indexOf(selection.text)
      : -1
  const address: Address =
    block !== null
      ? { kind: "block", ...at, block }
      : selection !== null && from >= 0
        ? {
            kind: "range",
            ...at,
            from,
            to: from + selection.text.length,
          }
        : { kind: "entry", ...at }
  return {
    address,
    markdown: markdownOf(address, {
      messageOf: entry => (entry === node.id ? node : undefined),
    }),
  }
}

/**
 * Whether a message draws its own text: a message that only called tools
 * shows only its tool rows.
 */
export const showsText = (node: TranscriptMessage): boolean =>
  node.text !== "" || node.toolCalls === undefined
