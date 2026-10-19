// session/ids — ids this client mints: uuidv7, so they sort oldest first and
// no two writers mint one key.

import {
  type CanvasId,
  canvasIdFor,
  type RootId,
  rootIdFor,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import {
  cardIdOfKind,
  type ImageId,
  type MediaId,
  type NoteColumnId,
  type ReferenceCardId,
  type TextCardId,
  textCardId,
} from "@pinetrie/threads"

/** A uuidv7: 48 bits of milliseconds, the version, the variant, randomness. */
function newUuidv7(): string {
  const time = Date.now().toString(16).padStart(12, "0")
  const rand = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
  const variant = ((Number.parseInt(rand.slice(3, 4), 16) & 3) | 8).toString(16)
  return `${time.slice(0, 8)}-${time.slice(8)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`
}

/** A new text card's id. */
export const newCardId = (): TextCardId => textCardId(newUuidv7())

/**
 * A new note column's id, minted by the page that makes the column with a
 * move. `parseCardId` accepts only this shape.
 */
export const newNoteColumnId = (): NoteColumnId =>
  cardIdOfKind("note-column", newUuidv7())

/** A new media column's id: `m-` and a uuidv7. */
export const newMediaId = (): MediaId => cardIdOfKind("media", newUuidv7())

/** A new image's id: `i-` and a uuidv7. */
export const newImageId = (): ImageId => cardIdOfKind("image", newUuidv7())

/** A new reference card's id: minted by the page that takes or puts it. */
export const newReferenceCardId = (): ReferenceCardId =>
  cardIdOfKind("reference", newUuidv7())

/**
 * A new thread's lane id, reserved by a column before the lane exists
 * The host accepts only this shape (`parseNewThread`).
 */
export const newThreadId = (): ThreadId => threadIdFor(newUuidv7())

/**
 * A new root's id, minted by the tab whose first message starts it
 * The host accepts only this shape (`parseNewRoot`).
 */
export const newRootId = (): RootId => rootIdFor(newUuidv7())

/**
 * A new canvas's id, minted by the tab that opens it, as it mints a root's
 * The host accepts only this shape (`parseNewCanvas`).
 */
export const newCanvasId = (): CanvasId => canvasIdFor(newUuidv7())
