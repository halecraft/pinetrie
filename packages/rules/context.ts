// context — the entries a run's context carries besides its conversation, in
// one table: a thread's pinned cards, a canvas's, and its canvas list.

import type { ContextInView } from "@pinetrie/core"
import { CANVAS_RULE, CANVAS_TYPE, decodeCanvas } from "./canvas.ts"
import { CANVAS_PINNED_TYPE, decodeCanvasPinned } from "./canvas-pinned.ts"
import { decodePinned, PINNED_RULE, PINNED_TYPE } from "./pinned.ts"

export type ContextKind = "pinned-cards" | "canvas-pinned-cards" | "canvas"

interface ContextSpec {
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
  "canvas-pinned-cards": {
    customType: CANVAS_PINNED_TYPE,
    decode: decodeCanvasPinned,
    carried: "canvasPinned",
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

/** The rules `<rules>` holds for context entries, each once, in the table's order. */
export const CONTEXT_RULES: readonly string[] = [
  ...new Set(CONTEXT_KINDS.map(k => CONTEXT[k].rule)),
]

/**
 * What `messages` carry, the newest of each kind (a compaction's retained
 * tail, read as `ContextInView`); empty when none is one.
 */
export function contextInView(messages: readonly unknown[]): ContextInView {
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
