// client/ask-bar — which ask the work at the top of a column belongs to
// (ADR-0056). Pure: `use-ask-bar.ts` measures, this decides.

import type { EntryId } from "@pineta/core"

/** An ask's work as drawn: its box, from the top of the column's view. */
export interface WorkBox {
  readonly ask: EntryId
  readonly top: number
  readonly bottom: number
}

/** What the bar shows: an ask whose message is above, here or in a column to the left. */
export type AtTop =
  | { readonly kind: "here"; readonly ask: EntryId }
  | { readonly kind: "elsewhere"; readonly ask: EntryId }

/**
 * The ask whose work is at the top of the view, when its message is not in
 * sight: scrolled above (`here`), or in a column to the left (`elsewhere`).
 * Null when no ask's work is at the top, or its message shows.
 * `prompts` are the tops of the asks' messages this column draws.
 */
export function askAtTop(
  works: readonly WorkBox[],
  prompts: ReadonlyMap<EntryId, number>,
): AtTop | null {
  const at = works.find(w => w.top <= 0 && w.bottom > 0)
  if (at === undefined) return null
  const prompt = prompts.get(at.ask)
  if (prompt === undefined) return { kind: "elsewhere", ask: at.ask }
  return prompt < 0 ? { kind: "here", ask: at.ask } : null
}

/** Whether two answers are the same, so a scroll that changes nothing draws nothing. */
export const sameAtTop = (a: AtTop | null, b: AtTop | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.ask === b.ask)
