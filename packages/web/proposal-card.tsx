// web/proposal-card — an agent's proposal of branches, drawn below its ask's
// last word: its rows, each opened to edit or dropped, and Start, Open or
// Send. `proposalView` (`@pinetrie/interface`) decides all of it; the reader's
// edits outlive an unmount in a `ScreenMemory`, as a tool row's state does.

import type { WriterId } from "@pinetrie/core"
import {
  type ColumnAct,
  NO_PROPOSAL_MEMORY,
  type ProposalButton,
  type ProposalFacts,
  type ProposalMemory,
  proposalView,
} from "@pinetrie/interface"
import type { ScreenMemory } from "@pinetrie/web-core"
import { useCallback, useRef, useState } from "react"
import { Button, IconButton } from "./button.tsx"
import { nameFor } from "./presence.tsx"

export function ProposalCard(p: {
  facts: ProposalFacts
  memory: ScreenMemory<ProposalMemory>
  /** Why nothing may be written here; null where you may. */
  readOnly: string | null
  nameOf: ReadonlyMap<WriterId, string>
  onAct: (act: ColumnAct) => void
}) {
  const [memory, change] = useRememberedProposal(p.memory, p.facts.proposal)
  const view = proposalView({
    facts: p.facts,
    memory,
    readOnly: p.readOnly,
    nameOf: w => nameFor(p.nameOf, w),
  })
  const press = (button: ProposalButton) => {
    if (button.press === null) return
    p.onAct({ kind: "proposal", proposal: view.proposal, press: button.press })
  }
  const button = (b: ProposalButton | null, className: string) =>
    b === null ? null : (
      <Button
        look="primary"
        className={className}
        disabled={b.press === null}
        onClick={() => press(b)}
      >
        {b.label}
      </Button>
    )
  return (
    <div className="proposal" data-proposal={view.proposal}>
      <ol className="proposal-rows">
        {view.rows.map(r => (
          <li
            className="proposal-row"
            data-dropped={r.dropped ? "" : undefined}
            key={r.row}
          >
            <Button
              look="plain"
              aria-expanded={r.open}
              className="proposal-title"
              onClick={() =>
                change(m => ({ ...m, open: toggled(m.open, r.row) }))
              }
            >
              {r.title}
            </Button>
            {r.open && view.editable && !r.dropped ? (
              <textarea
                className="proposal-brief"
                onChange={e => {
                  const text = e.target.value
                  change(m => ({
                    ...m,
                    edited: new Map([...m.edited, [r.row, text]]),
                  }))
                }}
                value={r.brief}
              />
            ) : (
              <span className="proposal-line">
                {r.open ? r.brief : r.firstLine}
              </span>
            )}
            {view.editable && (
              <IconButton
                look="primary"
                label={r.dropped ? "keep" : "drop"}
                className="proposal-drop"
                onClick={() =>
                  change(m => ({ ...m, dropped: toggled(m.dropped, r.row) }))
                }
              >
                {r.dropped ? "↺" : "×"}
              </IconButton>
            )}
          </li>
        ))}
      </ol>
      <div className="proposal-actions">
        {button(view.start, "proposal-start")}
        {button(view.open, "proposal-open")}
        {button(view.send, "proposal-send")}
        {view.state !== null && (
          <span className="proposal-state">{view.state}</span>
        )}
      </div>
    </div>
  )
}

/** `set` with `n` added, or taken out when it holds it. */
const toggled = (set: ReadonlySet<number>, n: number): ReadonlySet<number> => {
  const next = new Set(set)
  if (next.has(n)) next.delete(n)
  else next.add(n)
  return next
}

/** The card's memory, kept in `memory` at each change so an unmount loses nothing. */
function useRememberedProposal(
  memory: ScreenMemory<ProposalMemory>,
  key: string,
): [ProposalMemory, (update: (m: ProposalMemory) => ProposalMemory) => void] {
  const [state, setState] = useState(
    () => memory.get(key) ?? NO_PROPOSAL_MEMORY,
  )
  const current = useRef(state)
  const change = useCallback(
    (update: (m: ProposalMemory) => ProposalMemory) => {
      const next = update(current.current)
      current.current = next
      memory.remember(key, next)
      setState(next)
    },
    [memory, key],
  )
  return [state, change]
}
