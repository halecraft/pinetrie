// web/ask-work — one ask's work in a column, folded or open, laid out from
// `planAskWork`, which decides every row and word. It reads the reader's choice
// for its own ask (`FoldMemory`), so opening or closing one redraws it alone,
// as a tool row does.

import type { EntryId } from "@pinetrie/core"
import {
  ASK_FILES_TITLE,
  type AskSummary,
  type AskView,
  askFoldWords,
  type Density,
  type FoldMemory,
  planAskWork,
  type Segment,
  toggled,
} from "@pinetrie/interface"
import { pointsText } from "@pinetrie/rules"
import {
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

/** A fold line's parts, " · " between them. */
const FoldLine = ({ parts }: { parts: readonly string[] }) => parts.join(" · ")

/** An ask's digest: its headline, a model's, and its points under it. */
const Summary = ({ summary }: { summary: AskSummary }) => (
  <div className="ask-digest">
    <p>
      <Headline text={summary.headline} />
    </p>
    {summary.points.length > 0 && (
      <MessageText mode="committed" text={pointsText(summary.points)} />
    )}
  </div>
)

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
  // Its files open their review in the column's pane.
  const pane = useContext(PaneReach)
  const choice = useSyncExternalStore(
    folds.subscribe,
    useCallback(() => folds.get(ask) ?? null, [folds, ask]),
  )
  const draw = planAskWork(view, parts, { choice, density })
  const { open } = draw
  const toggle = () => folds.set(ask, toggled(open))
  const title = askFoldWords(open)
  // One flat list of children in `draw`'s order, each message keyed by its
  // entry: a message that moves into a fold as its run goes on keeps its
  // element, and a running tool row the element its result replaces its live
  // output in.
  const drawn: ReactNode[] = []
  if (draw.line !== null)
    drawn.push(
      <button
        aria-expanded={open}
        className={view.running ? "ask-line running" : "ask-line"}
        key="line"
        onClick={toggle}
        title={title}
        type="button"
      >
        <FoldLine parts={draw.line} />
      </button>,
    )
  const { summary } = draw
  const summaryRow =
    summary === null ? null : <Summary key="digest" summary={summary} />
  // The summary goes at its anchor alone: after the line, or before the
  // work, here; after its fold, below.
  if (summary !== null && summary.after.kind !== "fold") drawn.push(summaryRow)
  for (const row of draw.rows)
    switch (row.kind) {
      case "message":
        drawn.push(message(row.id))
        break
      case "fold":
        drawn.push(
          <div className="ask-fold-head" key={`fold-${row.ids[0]}`}>
            <button
              aria-expanded={open}
              className="ask-fold"
              data-first={row.first || undefined}
              onClick={toggle}
              title={title}
              type="button"
            >
              <FoldLine parts={row.parts} />
            </button>
            {row.files !== null && pane !== null && (
              <button
                className="ask-files"
                onClick={() => pane.open({ kind: "ask", ask })}
                title={ASK_FILES_TITLE}
                type="button"
              >
                {row.files}
              </button>
            )}
          </div>,
        )
        if (summary?.after.kind === "fold" && summary.after.fold === row.ids[0])
          drawn.push(summaryRow)
        break
      case "outcome":
        drawn.push(
          <div className="ask-outcome" key="outcome">
            {row.text}
          </div>,
        )
        break
    }
  return (
    <div className="ask-work" data-ask-of={ask} data-open={open || undefined}>
      {drawn}
    </div>
  )
}
