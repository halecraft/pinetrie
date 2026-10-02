// host/cards — where the host's shell opens card documents (ADR-0048).
// `startHost` reads one more, for the suites (`RunningHost.cardText`).
//
// Clients write cards; the host only reads who wrote in one, takes queued
// ones (`take.ts`), spends one when it is sent, and sweeps. It also gathers
// every card's text for the sweeps, so no text is read twice.

import { type Exchange, type Store, whenHydrated } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import type { CardId, WriterId } from "@pineta/core"
import { writersOf } from "@pineta/marginalia"
import { readCards, readSeats } from "@pineta/reads"
import {
  type CardsDocHandle,
  cardDocId,
  type SessionDocHandle,
  TextDoc,
  textClients,
  textHolds,
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
  /** Destroy its document: it was taken and sent, and the take deleted its record. */
  destroy(id: CardId): Promise<void>
  /** Load these cards' texts, so `textNow` reads each whole. */
  hydrate(ids: readonly CardId[]): Promise<void>
  /** A card's text as the host holds it now, with no wait: after `hydrate`. */
  textNow(id: CardId): string
  /**
   * Whether the host's copy of a card's text holds `seen` (`textHolds`): what
   * its queuer had when they queued it.
   */
  holds(id: CardId, seen: string): boolean
  /** Resolves once the host's copy holds `seen`. */
  whenHolds(id: CardId, seen: string): Promise<void>
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
    destroy: id => remove({ records: [], docs: [cardDocId(id)] }),
    async hydrate(ids) {
      for (const id of ids) await text(cardDocId(id))
    },
    textNow: id => exchange.get(cardDocId(id), TextDoc).text(),
    holds: (id, seen) => textHolds(exchange.get(cardDocId(id), TextDoc), seen),
    whenHolds(id, seen) {
      const t = exchange.get(cardDocId(id), TextDoc)
      return new Promise(resolve => {
        if (textHolds(t, seen)) return resolve()
        const stop = subscribe(t, () => {
          if (!textHolds(t, seen)) return
          stop()
          resolve()
        })
      })
    },
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
