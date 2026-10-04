// client/ask-work — one ask's work in a column, folded or open (ADR-0056).
// It reads the reader's choice for its own ask (`FoldMemory`), so opening or
// closing one redraws it alone, as a tool row does (ADR-0049).

import type { EntryId, Segment } from "@pineta/core"
import { type ReactNode, useCallback, useSyncExternalStore } from "react"
import { type FoldMemory, foldOpen, toggled } from "./ask-fold.ts"
import type { AskView } from "./ask-view.ts"
import type { Density } from "./ask-words.ts"
import { plural } from "./counts.ts"

export function AskWork({
  view,
  parts,
  density,
  folds,
  message,
  onReview,
}: {
  view: AskView
  /** Its segments on this column's path (`columnRows`). */
  parts: readonly Segment[]
  density: Density
  folds: FoldMemory
  /** A message of this column, drawn as the list draws it. */
  message: (id: EntryId) => ReactNode
  /** Open the review of this ask's files beside the column (ADR-0056). */
  onReview: (ask: EntryId) => void
}) {
  const { ask } = view
  const choice = useSyncExternalStore(
    folds.subscribe,
    useCallback(() => folds.get(ask) ?? null, [folds, ask]),
  )
  const open = foldOpen({
    choice,
    density,
    running: view.running,
    endedWhileAway: view.endedWhileAway,
  })
  const toggle = () => folds.set(ask, toggled(open))
  const outline = density === "outline"
  const hasFold = parts.some(s => s.kind === "fold")
  const ended = view.outcome === null ? "" : ` · ${view.outcome}`
  const summary = view.summary !== null && (
    <p
      className="ask-digest"
      key="summary"
      title="a summary, written by a model"
    >
      {view.summary}
    </p>
  )
  // One flat list of children, each message keyed by its entry: a message
  // that moves into a fold as its run goes on keeps its element, and a tool
  // row its output's scroll (ADR-0044).
  const drawn: ReactNode[] = []
  if (outline)
    drawn.push(
      <button
        aria-expanded={open}
        className={view.running ? "ask-line running" : "ask-line"}
        key="line"
        onClick={toggle}
        title={open ? "fold this ask's work" : "show this ask's work"}
        type="button"
      >
        {[view.outcome ?? view.live, view.digest]
          .filter(t => t !== null && t !== "")
          .join(" · ")}
      </button>,
    )
  if (outline || !hasFold) drawn.push(summary)
  for (const s of parts) {
    if (s.kind === "entry") {
      // Outline keeps what the rail draws apart, and folds the rest.
      if (!(outline && !open && s.id === view.outlineHides))
        drawn.push(message(s.id))
      continue
    }
    if (outline && !open) continue
    drawn.push(
      <div className="ask-fold-head" key={`fold-${s.ids[0]}`}>
        <button
          aria-expanded={open}
          className="ask-fold"
          data-first={s.first || undefined}
          onClick={toggle}
          title={open ? "fold this ask's work" : "show this ask's work"}
          type="button"
        >
          {s.first ? `${view.digest}${ended}` : plural(s.ids.length, "step")}
        </button>
        {s.first && view.span !== null && view.files > 0 && (
          <button
            className="ask-files"
            onClick={() => onReview(ask)}
            title="review what this ask changed"
            type="button"
          >
            {plural(view.files, "file")}
          </button>
        )}
      </div>,
    )
    if (s.first) drawn.push(summary)
    if (open) for (const id of s.ids) drawn.push(message(id))
  }
  if (!outline && !hasFold && view.outcome !== null)
    drawn.push(
      <div className="ask-outcome" key="outcome">
        {view.outcome}
      </div>,
    )
  return (
    <div className="ask-work" data-ask-of={ask} data-open={open || undefined}>
      {drawn}
    </div>
  )
}
