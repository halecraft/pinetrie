// web/card-history — a card's history, and who moved it back below the line.
// Every card's frame draws them (`card-frame.tsx`): the history in its body
// while its ⋯'s History is open, who moved it back in its header. What they
// read comes by context from `App`, which reads it once (`readCardHistories`),
// as a message's pane facts do (`pane-context.ts`): a prop through every editor
// would be one more for each to pass on.

import type {
  CardHistoryRecord,
  CardId,
  SeatRecord,
  TextCardId,
  WriterId,
} from "@pinetrie/core"
import {
  HISTORY_TITLE,
  historyWords,
  movedBackWords,
  type Reader,
  writtenWords,
} from "@pinetrie/interface"
import { movedBackBy, writersOfClients } from "@pinetrie/rules"
import { textClients } from "@pinetrie/schema"
import type { SessionClient } from "@pinetrie/session"
import { createContext, useContext } from "react"

interface CardHistoryFacts {
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

/** A card's history: its events, oldest first, and who has text in it. */
export function CardHistory({ card }: { card: TextCardId }) {
  const facts = useContext(CardHistories)
  if (facts === null) return null
  const events = facts.histories.get(card)?.events ?? []
  // The text's writers walk its operations: read only while it is drawn.
  const written = writtenWords(
    writersOfClients(textClients(facts.session.cardText(card)), facts.seats),
    facts.reader,
  )
  return (
    <section aria-label={HISTORY_TITLE} className="card-history-box">
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
    </section>
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
