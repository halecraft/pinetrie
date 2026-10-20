// web/folded-strip — what a folded column draws, a card's column or the canvas
// column: its header turned on its side, in the header's order. Its start
// (`start`: the toggle, and a card's box) sits where the unfolded header's
// does, so the toggle stays under the pointer; then one button that unfolds
// it, holding its mark, its name on its side, its detail and its dot. The
// name and mark are where a fold's turn lands (`data-fold-name`,
// `data-fold-mark`): at the header's size, so the turn ends on them exactly.

import {
  type ControlWords,
  type FoldedMark,
  stripTitle,
} from "@pinetrie/interface"
import type { ReactNode } from "react"
import { Button } from "./button.tsx"
import { ThreadMark } from "./thread-mark.tsx"

export function FoldedStrip(p: {
  /** The toggle, and a card's box: what the unfolded header starts with. */
  start: ReactNode
  unfold: ControlWords
  mark: FoldedMark
  name: string
  detail: string | null
  /** What the tooltip says before how to unfold: a thread's focus. */
  hint: string | null
  /** Its status's dot, after its name; null for none. */
  dot: ReactNode
  onUnfold: () => void
}) {
  return (
    <>
      <div className="folded-start">{p.start}</div>
      <Button
        look="plain"
        aria-label={`${p.unfold.title}: ${p.name}`}
        className="folded-title"
        onClick={p.onUnfold}
        title={stripTitle(p.unfold, p.hint)}
      >
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
        {p.dot}
      </Button>
    </>
  )
}
