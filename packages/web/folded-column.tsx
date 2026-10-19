// web/folded-column — a card's column folded to a strip in its place on the
// canvas: its card's glance, worded for a strip (`foldedWords`), in its
// thread's colour, drawn by `FoldedStrip`. Its head is a drag handle, as an
// unfolded column's is (`use-drag.ts`): folds are yours, the order
// everyone's. It has no ⋯ and no ⇤ or ×: a column is unfolded to act on it.

import {
  dropProps,
  type FoldedGlance,
  foldedMark,
  foldedWords,
  glanceCardId,
  type Intent,
  type PutTarget,
  UNFOLD,
} from "@pinetrie/interface"
import { dragProps } from "@pinetrie/web-core"
import { FoldedStrip } from "./folded-strip.tsx"
import { useTrackColors } from "./palette-context.ts"

export function FoldedColumn(p: {
  glance: FoldedGlance
  /** Its colour track: its thread's, as its column would take; a note column's is none. */
  track: number | null
  /** Where a drop on it lands: a spot on its canvas just after it; null where none does. */
  drop: PutTarget | null
  onIntent: (intent: Intent) => void
}) {
  const { glance } = p
  const card = glanceCardId(glance)
  const words = foldedWords(glance)
  const colors = useTrackColors()
  return (
    <section
      {...(p.drop === null ? {} : dropProps(p.drop))}
      className="folded-column"
      data-card={card}
      data-kind={glance.kind}
      style={p.track === null ? undefined : colors.style(p.track)}
    >
      {/* The handle a drag starts from; the strip below unfolds. */}
      <header
        className="column-head folded-head"
        data-color={p.track === null ? undefined : colors.slot(p.track)}
        data-column-head=""
        {...dragProps({ kind: "card", card })}
      >
        <span aria-hidden="true" className="folded-grip">
          ⠿
        </span>
      </header>
      <FoldedStrip
        detail={words.detail}
        hint={words.hint}
        mark={foldedMark(glance)}
        name={words.title}
        onUnfold={() => p.onIntent({ kind: "fold", card, unfolded: true })}
        unfold={UNFOLD}
      />
    </section>
  )
}
