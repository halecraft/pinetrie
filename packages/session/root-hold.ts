// session/root-hold — what holding the roots asked for changes: which roots'
// documents to open and which to let go; `root-docs.ts` carries it out.

import type { RootId } from "@pinetrie/core"

/** What holding changes: the roots to open, and those to let go. */
export interface HoldPlan {
  /** The roots this client started that the page does not yet ask for. */
  readonly minted: ReadonlySet<RootId>
  /** Every root to hold. */
  readonly want: ReadonlySet<RootId>
  readonly open: readonly RootId[]
  readonly drop: readonly RootId[]
}

/**
 * What to hold: what the page asks for, and a root this client started until
 * the page asks for it too. `minted` changes even when nothing opens or
 * goes: a root the page asks for leaves it, so that once the page stops
 * asking, the root goes.
 */
export function planHold(input: {
  readonly asked: ReadonlySet<RootId>
  readonly minted: ReadonlySet<RootId>
  readonly held: ReadonlySet<RootId>
}): HoldPlan {
  const minted = new Set([...input.minted].filter(r => !input.asked.has(r)))
  const want = new Set([...input.asked, ...minted])
  const open = [...want].filter(r => !input.held.has(r))
  const drop = [...input.held].filter(r => !want.has(r))
  return { minted, want, open, drop }
}
