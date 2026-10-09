// session/presence-seat — what this seat says about where it is (ADR-0024,
// ADR-0037). Runs in a browser and in Node alike: it touches only the
// Exchange.
//
// A person may be here from several seats, so each writes under its own key
// (`seatKey`), and one leaving takes only its own entries with it.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { CardId, WriterId } from "@pinetrie/core"
import { PRESENCE_DOC_ID } from "@pinetrie/protocol/messages"
import {
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  readingKey,
  seatKey,
} from "@pinetrie/schema"

export interface PresenceSeat {
  /** Who is here: read it through `@pinetrie/reads`; write it only here. */
  readonly handle: PresenceDocHandle
  /**
   * This seat's column `columnKey` follows the thread ending at `end`, in
   * the root whose root entry is `root` (null: not yet known).
   */
  setReading(
    columnKey: string,
    end: string,
    root: string | null,
    task: string | null,
  ): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /**
   * This seat is typing at `end`, in `card` when it is one already: the host
   * pops no card someone is typing in (ADR-0048 step 7). Silence decays
   * both.
   */
  setTyping(end: string, card: CardId | null): void
  /** This seat's typing goes with it; another seat of the same person keeps its own. */
  dispose(): void
}

export function presenceSeat(
  exchange: Exchange,
  me: WriterId,
  decay: PresenceDecay,
): PresenceSeat {
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(decay))
  const mine = seatKey(me, exchange.peerId)
  return {
    handle: presence,
    setReading(columnKey, end, root, task) {
      const key = readingKey(mine, columnKey)
      batch(presence, d => {
        d.reading.set(key, end)
        d.readingRoot.set(key, root)
        d.readingTask.set(key, task)
      })
    },
    clearReading(columnKey) {
      const key = readingKey(mine, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => {
          d.reading.delete(key)
          d.readingRoot.delete(key)
          d.readingTask.delete(key)
        })
    },
    setTyping(end, card) {
      batch(presence, d => {
        d.typing.set(mine, end)
        d.typingIn.set(mine, card)
      })
    },
    dispose() {
      if (
        presence.typing()[mine] !== undefined ||
        presence.typingIn()[mine] !== undefined
      )
        batch(presence, d => {
          d.typing.delete(mine)
          d.typingIn.delete(mine)
        })
    },
  }
}
