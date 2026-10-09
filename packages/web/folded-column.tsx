// web/folded-column — a column folded to a narrow strip with its title, in its
// place on the canvas (ADR-0116). Pressing it unfolds it. Its head is a drag
// handle, as an unfolded column's is (`use-column-drag.ts`): folds are yours,
// the order everyone's.

import { type FoldedView, type Intent, UNFOLD } from "@pinetrie/interface"

export function FoldedColumn(p: {
  view: FoldedView
  onIntent: (intent: Intent) => void
}) {
  const { view } = p
  return (
    <section
      className="folded-column"
      data-card={view.card}
      data-kind={view.kind}
    >
      {/* The handle a drag starts from; the strip below unfolds. */}
      <header className="column-head folded-head" data-column-head="">
        <span aria-hidden="true" className="folded-grip">
          ⠿
        </span>
      </header>
      <button
        aria-label={`${UNFOLD.title}: ${view.title}`}
        className="folded-title"
        onClick={() =>
          p.onIntent({ kind: "fold", card: view.card, unfolded: true })
        }
        title={UNFOLD.title}
        type="button"
      >
        <span aria-hidden="true" className={UNFOLD.className}>
          {UNFOLD.label}
        </span>
        <span className="folded-name">{view.title}</span>
        {view.detail !== null && (
          <span className="folded-detail">{view.detail}</span>
        )}
      </button>
    </section>
  )
}
