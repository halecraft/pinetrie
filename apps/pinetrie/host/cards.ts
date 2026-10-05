// host/cards — where the host's shell opens card documents (ADR-0048), the
// texts people type. `startHost` reads one more, for the suites
// (`RunningHost.cardText`).
//
// Where a card is lives in the places document, which `places.ts` writes;
// this port is about texts alone: who wrote in one, loading them for the
// queue's pops and a run's pinned cards, whether they hold what a queuer or
// a sender had, destroying a spent one, and gathering them for the sweeps, so no text
// is read twice.

import { type Exchange, type Store, whenHydrated } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import type { CardId, WriterId } from "@pinetrie/core"
import { readSeats } from "@pinetrie/reads"
import { writersOfClients } from "@pinetrie/rules"
import {
  cardDocId,
  type SessionDocHandle,
  TextDoc,
  textClients,
  textHolds,
} from "@pinetrie/schema"

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
   * Destroy its text: it was sent or removed, and its record is gone first.
   * Each client destroys its own copy once it has seen both (S64).
   */
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
  /**
   * Resolves once the host's copy holds `seen`, or once `signal` aborts:
   * either way it unsubscribes, so a wait given up leaves nothing behind.
   */
  whenHolds(id: CardId, seen: string, signal?: AbortSignal): Promise<void>
  /** These cards' texts, with who wrote in each. */
  texts(ids: readonly CardId[]): Promise<readonly GatheredText[]>
  /** Every stored card text document, by id. */
  stored(): Promise<readonly string[]>
  /** Destroy these stored documents, loaded first. */
  destroyDocs(docIds: readonly string[]): Promise<void>
}

export function startCards(input: {
  readonly exchange: Pick<Exchange, "get" | "destroy">
  readonly store: Pick<Store, "listDocIds">
  readonly session: SessionDocHandle
}): CardPort {
  const { exchange, store, session } = input
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
  async function destroyDocs(docIds: readonly string[]) {
    for (const docId of docIds) {
      // Destroyed as held: a stored document is loaded before it goes.
      await text(docId)
      await exchange.destroy(docId)
    }
  }
  return {
    async writers(id) {
      return writersOfClients(
        textClients(await text(cardDocId(id))),
        readSeats(session),
      )
    },
    destroy: id => destroyDocs([cardDocId(id)]),
    async hydrate(ids) {
      for (const id of ids) await text(cardDocId(id))
    },
    textNow: id => exchange.get(cardDocId(id), TextDoc).text(),
    holds: (id, seen) => textHolds(exchange.get(cardDocId(id), TextDoc), seen),
    whenHolds(id, seen, signal) {
      const t = exchange.get(cardDocId(id), TextDoc)
      return new Promise(resolve => {
        if (textHolds(t, seen) || signal?.aborted === true) return resolve()
        const done = () => {
          stop()
          signal?.removeEventListener("abort", done)
          resolve()
        }
        const stop = subscribe(t, () => {
          if (textHolds(t, seen)) done()
        })
        signal?.addEventListener("abort", done, { once: true })
      })
    },
    async texts(ids) {
      const out: GatheredText[] = []
      for (const id of ids) {
        const t = await text(cardDocId(id))
        out.push({ id, text: t.text(), clients: textClients(t) })
      }
      return out
    },
    async stored() {
      return listed("card:")
    },
    destroyDocs,
  }
}
