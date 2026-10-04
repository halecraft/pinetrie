// client/card-history — a card's history, and who moved it back below the
// line (ADR-0048 step 6). Every card's editor draws them: the composer,
// others' cards, queued and pinned cards, and the inventory's selected
// card. What they read comes by context from `App`, which reads it once
// (`readCardHistories`), as a message's pane facts do (`pane-context.ts`):
// a prop through every editor would be one more for each to pass on.

import type {
  CardHistoryRecord,
  CardId,
  SeatRecord,
  WriterId,
} from "@pineta/core"
import { movedBackBy, writersOfClients } from "@pineta/rules"
import { textClients } from "@pineta/schema"
import type { SessionClient } from "@pineta/session"
import { createContext, useContext } from "react"
import {
  HISTORY,
  HISTORY_TITLE,
  historyWords,
  movedBackWords,
  writtenWords,
} from "./card-words.ts"
import { Popover } from "./popover.tsx"
import type { Reader } from "./send.ts"

export interface CardHistoryFacts {
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  /** Every seat the host has seen: who has text in a card. */
  readonly seats: readonly SeatRecord[]
  readonly session: SessionClient
  readonly reader: Reader
}

/** `App`'s histories and readers; null outside it, where nothing is drawn. */
export const CardHistories = createContext<CardHistoryFacts | null>(null)

const time = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** A card's history button, opening its events, oldest first, and its writers. */
export function CardHistory({ card }: { card: CardId }) {
  const facts = useContext(CardHistories)
  if (facts === null) return null
  const events = facts.histories.get(card)?.events ?? []
  return (
    <Popover
      boxClassName="popover card-history-box"
      className="card-history"
      heading={HISTORY_TITLE}
      label={HISTORY}
      onOpen={() => {}}
      role="dialog"
      title={HISTORY_TITLE}
      trigger={HISTORY}
      triggerClassName="card-history-trigger"
    >
      {() => {
        // Read only while open: the text's writers walk its operations.
        const written = writtenWords(
          writersOfClients(
            textClients(facts.session.cardText(card)),
            facts.seats,
          ),
          facts.reader,
        )
        return (
          <ol className="card-history-events">
            {events.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a history only grows at its end; two events can share a time
              <li data-event={e.kind} key={i}>
                {historyWords(e, facts.reader)}{" "}
                <span className="card-history-at">{time(e.at)}</span>
              </li>
            ))}
            {written !== null && (
              <li className="card-history-writers">{written}</li>
            )}
          </ol>
        )
      }}
    </Popover>
  )
}

/** "unqueued by Bea", on a card someone other than its owner moved back. */
export function MovedBack(p: { card: CardId; owner: WriterId }) {
  const facts = useContext(CardHistories)
  const moved =
    facts === null ? null : movedBackBy(facts.histories.get(p.card), p.owner)
  return moved === null || facts === null ? null : (
    <span className="moved-back">{movedBackWords(moved, facts.reader)}</span>
  )
}
