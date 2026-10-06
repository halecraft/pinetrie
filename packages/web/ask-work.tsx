// web/ask-work — one ask's work in a column, folded or open (ADR-0056).
// It reads the reader's choice for its own ask (`FoldMemory`), so opening or
// closing one redraws it alone, as a tool row does (ADR-0049).

import type { EntryId } from "@pinetrie/core"
import {
  type AskView,
  type Density,
  digestApart,
  type FoldMemory,
  type FoldPart,
  foldOpen,
  foldWords,
  plural,
  type Segment,
  toggled,
} from "@pinetrie/interface"
import { pointsText } from "@pinetrie/rules"
import {
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react"
import { MessageText } from "./message-text.tsx"
import { PaneReach } from "./pane-context.ts"

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
}: {
  view: AskView
  /** Its segments on this column's path (`columnRows`). */
  parts: readonly Segment[]
  density: Density
  folds: FoldMemory
  /** A message of this column, drawn as the list draws it. */
  message: (id: EntryId) => ReactNode
}) {
  const { ask } = view
  // Its files open their review in the column's pane (ADR-0056, ADR-0078).
  const pane = useContext(PaneReach)
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
  const apart = digestApart({ density, open, hasFold })
  if (apart) drawn.push(digest(true))
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
        {s.first && view.span !== null && view.files > 0 && pane !== null && (
          <button
            className="ask-files"
            onClick={() => pane.open({ kind: "ask", ask })}
            title="review what this ask changed"
            type="button"
          >
            {plural(view.files, "file")}
          </button>
        )}
      </div>,
    )
    if (s.first && !apart) drawn.push(digest(false))
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
