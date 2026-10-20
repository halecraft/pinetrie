// web/folded-column — a card's column folded to a strip in its place on the
// canvas: its head as `columnHead` decides it folded (its toggle and box), and
// its card's glance, worded for a strip (`foldedWords`), in its thread's
// colour, drawn by `FoldedStrip`. The whole strip is a drag handle, as an
// unfolded column's header is (`use-drag.ts`): a press that moves drags, one
// that does not is its click. Folds are yours, the order and the box
// everyone's. It has no ⋯: a column is unfolded to act on it.

import type { ThreadId, WriterId } from "@pinetrie/core"
import {
  columnHead,
  dropProps,
  type FoldedGlance,
  foldedMark,
  foldedWords,
  foldToggle,
  glanceCardId,
  type Intent,
  type Moments,
  type PutTarget,
} from "@pinetrie/interface"
import { dragProps } from "@pinetrie/web-core"
import { ColumnHeadStart } from "./column-menu.tsx"
import { FoldedStrip } from "./folded-strip.tsx"
import { useTrackColors } from "./palette-context.ts"
import { ColumnDot } from "./root-signals.tsx"

export function FoldedColumn(p: {
  glance: FoldedGlance
  /** Its colour track: its thread's, as its column would take; a note column's is none. */
  track: number | null
  /** Where a drop on it lands: a spot on its canvas just after it; null where none does. */
  drop: PutTarget | null
  /** Its card's box (`ColumnContent`). */
  ticked: boolean
  /** Whether the reader may change the canvas: its box is theirs to change. */
  writable: boolean
  /** When each thread's mark last arrived, and its ✓ last showed. */
  arrivals: Moments<ThreadId>
  nameOf: ReadonlyMap<WriterId, string>
  onIntent: (intent: Intent) => void
}) {
  const { glance } = p
  const card = glanceCardId(glance)
  const words = foldedWords(glance)
  const colors = useTrackColors()
  const head = columnHead({
    card,
    width: 1,
    writable: p.writable,
    unstarted: false,
    folded: true,
    ticked: p.ticked,
  })
  return (
    <section
      {...(p.drop === null ? {} : dropProps(p.drop))}
      {...dragProps({ kind: "card", card })}
      className="folded-column"
      data-card={card}
      data-color={p.track === null ? undefined : colors.slot(p.track)}
      data-column-head=""
      data-kind={glance.kind}
      data-ticked={p.ticked ? "" : undefined}
      style={p.track === null ? undefined : colors.style(p.track)}
    >
      <FoldedStrip
        detail={words.detail}
        dot={
          glance.kind === "thread" ? (
            <ColumnDot
              arrived={p.arrivals.arrived.get(glance.thread) ?? null}
              done={p.arrivals.done.get(glance.thread) ?? null}
              nameOf={p.nameOf}
              status={glance.status}
            />
          ) : null
        }
        hint={words.hint}
        mark={foldedMark(glance)}
        name={words.title}
        onUnfold={() => p.onIntent({ kind: "fold", card, unfolded: true })}
        start={<ColumnHeadStart head={head} onIntent={p.onIntent} />}
        unfold={foldToggle(true)}
      />
    </section>
  )
}
