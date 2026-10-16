// web/folded-strip — what a folded column draws, a card's column or the canvas
// column: its unfold mark, its mark, its name on its side, its detail, all
// one button that unfolds it. The name and mark are where a fold's turn
// lands (`data-fold-name`, `data-fold-mark`): a column's header turned on
// its side, at the header's size, so the turn ends on them exactly.

import type { ControlWords, FoldedMark } from "@pinetrie/interface"
import { ThreadMark } from "./thread-mark.tsx"

export function FoldedStrip(p: {
  unfold: ControlWords
  mark: FoldedMark
  name: string
  detail: string | null
  onUnfold: () => void
}) {
  return (
    <button
      aria-label={`${p.unfold.title}: ${p.name}`}
      className="folded-title"
      onClick={p.onUnfold}
      title={p.unfold.title}
      type="button"
    >
      <span aria-hidden="true" className={p.unfold.className}>
        {p.unfold.label}
      </span>
      {p.mark.kind === "thread" && (
        <ThreadMark
          icon={p.mark.icon}
          folds
          running={false}
          working={undefined}
        />
      )}
      <span className="folded-name" data-fold-name="">
        {p.name}
      </span>
      {p.detail !== null && <span className="folded-detail">{p.detail}</span>}
    </button>
  )
}
