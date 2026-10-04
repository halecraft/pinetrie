// client/ask-work — one ask's work in a column, folded or open (ADR-0056).
// It reads the reader's choice for its own ask (`FoldMemory`), so opening or
// closing one redraws it alone, as a tool row does (ADR-0049).

import type { EntryId, Segment } from "@pineta/core"
import { pointsText } from "@pineta/marginalia"
import {
  Fragment,
  type ReactNode,
  useCallback,
  useSyncExternalStore,
} from "react"
import { type FoldMemory, foldOpen, toggled } from "./ask-fold.ts"
import type { AskView } from "./ask-view.ts"
import { type Density, type FoldPart, foldWords } from "./ask-words.ts"
import { plural } from "./counts.ts"
import { MessageText } from "./message-text.tsx"

/** A model's words, marked as such. */
const Headline = ({ text }: { text: string }) => (
  <span className="ask-headline" title="written by a model">
    {text}
  </span>
)

/** A fold line's parts, " · " between them, a headline marked. */
const FoldLine = ({ parts }: { parts: readonly FoldPart[] }) =>
  parts.map((p, i) => (
    <Fragment key={p.byModel ? "headline" : p.text}>
      {i > 0 && " · "}
      {p.byModel ? <Headline text={p.text} /> : p.text}
    </Fragment>
  ))

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
  // A fold's head carries the headline; with none to carry it, the digest
  // holds it above the points.
  const digest = (withHeadline: boolean) => {
    const headline = withHeadline ? view.headline : null
    if (headline === null && view.points.length === 0) return null
    return (
      <div className="ask-digest" key="digest">
        {headline !== null && (
          <p>
            <Headline text={headline} />
          </p>
        )}
        {view.points.length > 0 && (
          <MessageText mode="committed" text={pointsText(view.points)} />
        )}
      </div>
    )
  }
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
        <FoldLine parts={foldWords(view, "line")} />
      </button>,
    )
  if (!outline && !hasFold) drawn.push(digest(true))
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
          {s.first ? (
            <FoldLine parts={foldWords(view, "fold")} />
          ) : (
            plural(s.ids.length, "step")
          )}
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
    if (s.first) drawn.push(digest(false))
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
