// client/card-texts — each card's text document, and the end of this
// client's copy once the host has spent the card (S64). Runs in a browser and
// in Node alike: it touches only the Exchange.
//
// Each card document this client opens is watched until the host destroys
// it, and then this client's copy is destroyed too, so no step on it stands
// and no undo or redo in its box can write into it. The host's `dismiss`
// leaves a receiver's copy in place, so the copy watches for the host to let
// go of it (`hostLetGo`), and goes once its record has gone too
// (`spentCards`).

import { type Exchange, sync } from "@kyneta/exchange"
import type { CardId } from "@pineta/core"
import { cardDocId, TextDoc, type TextDocHandle } from "@pineta/schema"
import { hostLetGo, spentCards } from "./card-state.ts"

export interface CardTexts {
  /** A card's text: the same document for every caller. */
  text(id: CardId): TextDocHandle
  /** Destroy each copy the host let go of whose card's record has gone. */
  sweep(): void
  /** Stop watching every copy. */
  dispose(): void
}

export function cardTexts(
  exchange: Exchange,
  host: string,
  /** Whether a card's record is live in this client's copy of the places. */
  isLive: (id: CardId) => boolean,
): CardTexts {
  const watched = new Map<CardId, () => void>()
  const letGo = new Set<CardId>()
  const hostIn = (states: readonly { peer: { peerId: string } }[]) =>
    states.some(s => s.peer.peerId === host)
  const sweep = () => {
    for (const id of spentCards(letGo, isLive)) {
      letGo.delete(id)
      void exchange.destroy(cardDocId(id))
    }
  }
  return {
    text(id) {
      const text = exchange.get(cardDocId(id), TextDoc)
      if (watched.has(id)) return text
      let hadHost = hostIn(sync(text).peerStates)
      const stop = sync(text).onPeerSyncChange(states => {
        const hasHost = hostIn(states)
        const gone = hostLetGo({
          hadHost,
          hasHost,
          hostConnected: exchange.peers.current.has(host),
        })
        hadHost = hasHost
        if (!gone) return
        stop()
        watched.delete(id)
        letGo.add(id)
        sweep()
      })
      watched.set(id, stop)
      return text
    },
    sweep,
    dispose() {
      for (const stop of watched.values()) stop()
      watched.clear()
    },
  }
}
