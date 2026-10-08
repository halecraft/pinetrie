// session/ids — ids this client mints: uuidv7, so they sort oldest first and
// no two writers mint one key (ADR-0016).

import {
  type CardId,
  cardId,
  type RootId,
  rootIdFor,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"

/** A uuidv7: 48 bits of milliseconds, the version, the variant, randomness. */
export function newUuidv7(): string {
  const time = Date.now().toString(16).padStart(12, "0")
  const rand = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
  const variant = ((Number.parseInt(rand.slice(3, 4), 16) & 3) | 8).toString(16)
  return `${time.slice(0, 8)}-${time.slice(8)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`
}

/** A new card's id. */
export const newCardId = (): CardId => cardId(newUuidv7())

/**
 * A new thread's lane id, reserved by a column before the lane exists
 * (ADR-0057). The host accepts only this shape (`parseNewThread`).
 */
export const newThreadId = (): ThreadId => threadIdFor(newUuidv7())

/**
 * A new root's id, minted by the tab whose first message starts it
 * (ADR-0063). The host accepts only this shape (`parseNewRoot`).
 */
export const newRootId = (): RootId => rootIdFor(newUuidv7())
