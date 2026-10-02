// host/cards — where the host's shell opens card documents (ADR-0048).
// `startHost` reads one more, for the suites (`RunningHost.cardText`).
//
// Clients write cards; the host only reads who wrote in one, spends one when
// it is sent, and sweeps. It also gathers every card's text for the sweeps,
// so no text is read twice.

import { type Exchange, type Store, whenHydrated } from "@kyneta/exchange"
import type { CardId, WriterId } from "@pineta/core"
import { writersOf } from "@pineta/marginalia"
import { readCards, readSeats } from "@pineta/reads"
import {
  type CardsDocHandle,
  cardDocId,
  type SessionDocHandle,
  TextDoc,
  textClients,
} from "@pineta/schema"

/** A card's text, as the sweeps need it. */
export interface GatheredText {
  readonly id: CardId
  readonly text: string
  /** The `clientID`s that wrote in it (`textClients`). */
  readonly clients: readonly number[]
}

export interface CardPort {
  /** The people who wrote in the card: its `clientID`s through the seat records. */
  writers(id: CardId): Promise<readonly WriterId[]>
  /**
   * Delete its record, then destroy its document: it was sent. Each client
   * destroys its own copy once it has seen both (S64).
   */
  spend(id: CardId): Promise<void>
  /** Every live card's text, with who wrote in it. */
  texts(): Promise<readonly GatheredText[]>
  /** Every stored card text document, by id. */
  stored(): Promise<readonly string[]>
  /** Delete these card records, then destroy these documents. */
  remove(what: {
    readonly records: readonly CardId[]
    readonly docs: readonly string[]
  }): Promise<void>
}

export function startCards(input: {
  readonly exchange: Pick<Exchange, "get" | "destroy">
  readonly store: Pick<Store, "listDocIds">
  readonly doc: SessionDocHandle
  readonly cards: CardsDocHandle
}): CardPort {
  const { exchange, store, doc, cards } = input
  /** A text as stored: loaded first, so what it holds is all of it. */
  const text = async (docId: string) => {
    const t = exchange.get(docId, TextDoc)
    await whenHydrated(t)
    return t
  }
  const listed = async (prefix: string) => {
    const out: string[] = []
    for await (const id of store.listDocIds(prefix)) out.push(id)
    return out
  }
  async function remove(what: {
    readonly records: readonly CardId[]
    readonly docs: readonly string[]
  }) {
    for (const id of what.records) cards.cards.delete(id)
    for (const docId of what.docs) {
      // Destroyed as held: a stored document is loaded before it goes.
      await text(docId)
      await exchange.destroy(docId)
    }
  }
  return {
    async writers(id) {
      return writersOf(textClients(await text(cardDocId(id))), readSeats(doc))
    },
    spend: id => remove({ records: [id], docs: [cardDocId(id)] }),
    async texts() {
      const out: GatheredText[] = []
      for (const c of readCards(cards)) {
        const t = await text(cardDocId(c.id))
        out.push({ id: c.id, text: t.text(), clients: textClients(t) })
      }
      return out
    },
    async stored() {
      return listed("card:")
    },
    remove,
  }
}
