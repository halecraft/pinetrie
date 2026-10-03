// client/presence-seat — what this seat says about where it is (ADR-0024,
// ADR-0037). Runs in a browser and in Node alike: it touches only the
// Exchange.
//
// A person may be here from several seats, so each writes under its own key
// (`seatKey`), and one leaving takes only its own entries with it.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { WriterId } from "@pineta/core"
import { PRESENCE_DOC_ID } from "@pineta/protocol/messages"
import {
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  readingKey,
  seatKey,
} from "@pineta/schema"

export interface PresenceSeat {
  /** Who is here: read it through `@pineta/reads`; write it only here. */
  readonly handle: PresenceDocHandle
  /**
   * This seat's column `columnKey` follows the thread ending at `end`, in
   * the root whose root entry is `root` (null: not yet known).
   */
  setReading(columnKey: string, end: string, root: string | null): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /** This seat is typing in the composer at `end`. Silence decays it. */
  setTyping(end: string): void
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
    setReading(columnKey, end, root) {
      const key = readingKey(mine, columnKey)
      batch(presence, d => {
        d.reading.set(key, end)
        d.readingRoot.set(key, root)
      })
    },
    clearReading(columnKey) {
      const key = readingKey(mine, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => {
          d.reading.delete(key)
          d.readingRoot.delete(key)
        })
    },
    setTyping(end) {
      batch(presence, d => d.typing.set(mine, end))
    },
    dispose() {
      if (presence.typing()[mine] !== undefined)
        batch(presence, d => d.typing.delete(mine))
    },
  }
}
