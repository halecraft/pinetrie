// web/thread-card — a thread card's header: its mark, its label, ⇡ for work
// ready to accept, and your pip. The board's cards and the sidebar's items draw
// it from the same value (`ThreadCardHead`), so a root reads the same in both.
// Neutral: never in the thread's colour.

import type { WriterId } from "@pinetrie/core"
import { readyWords, type ThreadCardHead } from "@pinetrie/interface"
import type { ReactNode } from "react"
import { RootStatus } from "./root-signals.tsx"

export function ThreadHead(p: {
  head: ThreadCardHead
  /** The label's class: what each place's CSS and checks read. */
  labelClass: string
  nameOf: ReadonlyMap<WriterId, string>
  /** Your pip, drawn when you have unsent text there. */
  pip: ReactNode
  /** When its mark rose as you watched, and when its run ended: the sidebar's. */
  arrived?: number | null
  done?: number | null
}) {
  const { head } = p
  return (
    <>
      <RootStatus
        arrived={p.arrived ?? null}
        done={p.done ?? null}
        nameOf={p.nameOf}
        status={head.status}
      />
      <span className={p.labelClass}>{head.label}</span>
      {head.ready.length > 0 && (
        <span
          aria-label={readyWords(head.ready)}
          className="root-ready"
          role="img"
          title={readyWords(head.ready)}
        >
          ⇡
        </span>
      )}
      {head.pip && p.pip}
    </>
  )
}
