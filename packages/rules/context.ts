// context — the entries a run's context carries besides its conversation
// (ADR-0048, ADR-0116), one table: a thread's pinned cards, a task's pinned
// cards and the task's canvas list. Each kind says how a stored message is
// known as one (its decoder), what the column draws for it, and the rule
// `<rules>` holds for it. Each is written only when it differs from the
// newest of its kind on the thread's path (`pinnedInView`,
// `taskPinnedInView`, `canvasInView`), so an unchanged one keeps the
// prompt's cache (S92). pi's compaction carries the newest of each kind
// (`carryContext`), and the system prompt lists their rules (`CONTEXT_RULES`),
// both from this table, so a kind can be neither sent without its rule nor
// summarised away.

import type { ContextInView } from "@pinetrie/core"
import { CANVAS_RULE, CANVAS_TYPE, decodeCanvas } from "./canvas.ts"
import { decodePinned, PINNED_RULE, PINNED_TYPE } from "./pinned.ts"
import { decodeTaskPinned, TASK_PINNED_TYPE } from "./task-pinned.ts"

/** Each kind of context entry. */
export type ContextKind = "pinned-cards" | "task-pinned-cards" | "canvas"

/** One kind of context entry. */
export interface ContextSpec {
  readonly customType: string
  /** A stored message -> what it says, or undefined if it is not this kind. */
  readonly decode: (message: unknown) => unknown
  /** Where it goes in what a compaction carries (`ContextInView`). */
  readonly carried: keyof ContextInView
  /** The line every thread's `<rules>` holds for it. */
  readonly rule: string
}

/**
 * Every kind of context entry, with its decoder and its rule, in the order
 * a run's entries are written before its prompt: a thread's pinned cards
 * last, so its cards entry stays the prompt's parent.
 */
export const CONTEXT = {
  canvas: {
    customType: CANVAS_TYPE,
    decode: decodeCanvas,
    carried: "canvas",
    rule: CANVAS_RULE,
  },
  "task-pinned-cards": {
    customType: TASK_PINNED_TYPE,
    decode: decodeTaskPinned,
    carried: "taskPinned",
    rule: PINNED_RULE,
  },
  "pinned-cards": {
    customType: PINNED_TYPE,
    decode: decodePinned,
    carried: "pinned",
    rule: PINNED_RULE,
  },
} as const satisfies Record<ContextKind, ContextSpec>

/** The kinds, in the table's order. */
export const CONTEXT_KINDS = Object.keys(CONTEXT) as readonly ContextKind[]

/** The kind of context entry `message` is; null for any other message. */
export const contextKindOf = (message: unknown): ContextKind | null =>
  CONTEXT_KINDS.find(k => CONTEXT[k].decode(message) !== undefined) ?? null

/** The rules `<rules>` holds for context entries, each once, in the table's order. */
export const CONTEXT_RULES: readonly string[] = [
  ...new Set(CONTEXT_KINDS.map(k => CONTEXT[k].rule)),
]

/**
 * What `messages` carry, the newest of each kind (a compaction's retained
 * tail, read as `ContextInView`); empty when none is one. Pure.
 */
export function contextOf(messages: readonly unknown[]): ContextInView {
  const out: Partial<Record<keyof ContextInView, unknown>> = {}
  for (const message of messages)
    for (const kind of CONTEXT_KINDS) {
      const spec: ContextSpec = CONTEXT[kind]
      const view = spec.decode(message)
      if (view !== undefined) out[spec.carried] = view
    }
  // Each kind's decoder gives the view its `carried` key holds.
  return out as ContextInView
}
