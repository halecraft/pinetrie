// web/folded-column — a column folded to a narrow strip with its title, in its
// place on the canvas (ADR-0116): its card's face (ADR-0126), worded for a
// strip (`foldedWords`). Pressing it unfolds it. Its head is a drag handle,
// as an unfolded column's is (`use-column-drag.ts`): folds are yours, the
// order everyone's.

import {
  cardOfFace,
  dropProps,
  type FoldedFace,
  foldedWords,
  type Intent,
  type PutTarget,
  UNFOLD,
} from "@pinetrie/interface"

export function FoldedColumn(p: {
  face: FoldedFace
  /** Where a drop on it lands: a spot on its canvas just after it; null where none does. */
  drop: PutTarget | null
  onIntent: (intent: Intent) => void
}) {
  const { face } = p
  const card = cardOfFace(face)
  const words = foldedWords(face)
  return (
    <section
      {...(p.drop === null ? {} : dropProps(p.drop))}
      className="folded-column"
      data-card={card}
      data-kind={face.kind}
    >
      {/* The handle a drag starts from; the strip below unfolds. */}
      <header className="column-head folded-head" data-column-head="">
        <span aria-hidden="true" className="folded-grip">
          ⠿
        </span>
      </header>
      <button
        aria-label={`${UNFOLD.title}: ${words.title}`}
        className="folded-title"
        onClick={() => p.onIntent({ kind: "fold", card, unfolded: true })}
        title={UNFOLD.title}
        type="button"
      >
        <span aria-hidden="true" className={UNFOLD.className}>
          {UNFOLD.label}
        </span>
        <span className="folded-name">{words.title}</span>
        {words.detail !== null && (
          <span className="folded-detail">{words.detail}</span>
        )}
      </button>
    </section>
  )
}
