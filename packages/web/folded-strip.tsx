// web/folded-strip — what a folded column draws, a card's column or the canvas
// column: its header turned on its side, in the header's order. Its start
// (`start`: the toggle, and a card's box) sits where the unfolded header's
// does, so the toggle stays under the pointer; then its handle, holding its
// mark, its name on its side and its detail, which a drag starts from and a
// click does nothing on; then a card's status button. Only the toggle and the
// status button unfold it. The name and mark are where a fold's turn lands
// (`data-fold-name`, `data-fold-mark`): at the header's size, so the turn ends
// on them exactly.

import type { CardId } from "@pinetrie/core"
import type { FoldedMark } from "@pinetrie/interface"
import type { ReactNode } from "react"
import { ColumnHandle } from "./column-menu.tsx"
import { ThreadMark } from "./thread-mark.tsx"

export function FoldedStrip(p: {
  /** The toggle, and a card's box: what the unfolded header starts with. */
  start: ReactNode
  /** Its card, whose handle it draws; null for the canvas column, which no drag moves. */
  card: CardId | null
  mark: FoldedMark
  name: string
  detail: string | null
  /** The handle's title: a thread's focus; null for none. */
  hint: string | null
  /** Its status button, after its name; null for none. */
  status: ReactNode
}) {
  const inner = (
    <>
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
    </>
  )
  const title = p.hint ?? undefined
  return (
    <>
      <div className="folded-start">{p.start}</div>
      <div className="folded-title">
        {p.card === null ? (
          <span className="head-handle" title={title}>
            {inner}
          </span>
        ) : (
          <ColumnHandle card={p.card} title={title}>
            {inner}
          </ColumnHandle>
        )}
        {p.status}
      </div>
    </>
  )
}
