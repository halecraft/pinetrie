// card-read — what `read_card` answers: a card of the thread's canvas, by
// the id the canvas list gives, read whole. An image is its version's fitted
// copy, which the tool hands the model as an image; a media column and a note
// column are text.

import {
  type CanvasId,
  type CardId,
  type CardRecord,
  isImageId,
  isMediaId,
  isNoteColumnId,
  type Sha256,
  type ThreadId,
  type TitledCardId,
} from "@pinetrie/core"
import { NEW_MEDIA_TITLE, UNTITLED_IMAGE } from "./canvas.ts"
import type { CardTitleRecord } from "./card-title.ts"
import { count } from "./counts.ts"
import { imagesIn } from "./media.ts"
import { NEW_NOTES_TITLE, notesIn } from "./notes.ts"

/** What `read_card` answers: words, and for an image the blob it shows. */
export type CardRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly text: string; readonly sha256: Sha256 }
  | { readonly kind: "refused"; readonly text: string }

const refused = (text: string): CardRead => ({ kind: "refused", text })

/** The canvas a card of a column is on; null for none. */
function canvasOf(cards: readonly CardRecord[], id: CardId): CanvasId | null {
  const card = cards.find(c => c.id === id)
  if (card === undefined) return null
  if (card.place.kind === "canvas") return card.place.canvas
  return card.place.kind === "image" ? canvasOf(cards, card.place.column) : null
}

/**
 * `card` read for the agent of `thread`: refused for a thread on no canvas,
 * a card on another canvas or none, a kind it does not read, and a version
 * the image does not have. `version` counts from 1; null reads the newest.
 * `noteTexts` holds each note's text a note column read needs.
 */
export function planCardRead(input: {
  readonly card: string
  readonly version: number | null
  readonly thread: ThreadId
  readonly cards: readonly CardRecord[]
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  readonly noteTexts: ReadonlyMap<CardId, string>
}): CardRead {
  const { cards, titles } = input
  const here = canvasOf(cards, input.thread)
  if (here === null) return refused("This thread is on no canvas.")
  const id = input.card.trim()
  if (!isImageId(id) && !isMediaId(id) && !isNoteColumnId(id))
    return refused(
      `${id} is no image, media column or note column: read one by the id the canvas list gives.`,
    )
  if (canvasOf(cards, id) !== here)
    return refused(`No card on this canvas is ${id}.`)
  const title = (card: TitledCardId, fallback: string) =>
    titles.get(card)?.title ?? fallback
  if (isImageId(id)) {
    const image = cards.find(c => c.id === id)
    if (image?.kind !== "image" || image.place.kind !== "image")
      return refused(`No card on this canvas is ${id}.`)
    const { versions } = image.content
    const n = input.version ?? versions.length
    const shown = versions[n - 1]
    if (shown === undefined)
      return refused(
        `${id} has ${count(versions.length, "version", "versions")}.`,
      )
    return {
      kind: "image",
      sha256: shown.sha256,
      text: `Image "${title(id, UNTITLED_IMAGE)}" (${id}), version ${n} of ${versions.length}, in media column "${title(image.place.column, NEW_MEDIA_TITLE)}".`,
    }
  }
  if (isMediaId(id)) {
    const images = imagesIn(cards, id)
    const lines = images.map(
      i =>
        `- "${title(i.id, UNTITLED_IMAGE)}" (${i.id}, ${count(i.content.versions.length, "version", "versions")})`,
    )
    return {
      kind: "text",
      text: [
        `Media column "${title(id, NEW_MEDIA_TITLE)}" (${id}), ${count(images.length, "image", "images")}${lines.length === 0 ? "." : ":"}`,
        ...lines,
      ].join("\n"),
    }
  }
  const notes = notesIn(cards, id)
  return {
    kind: "text",
    text: [
      `Note column "${title(id, NEW_NOTES_TITLE)}" (${id}), ${count(notes.length, "note", "notes")}${notes.length === 0 ? "." : ":"}`,
      ...notes.map(n => input.noteTexts.get(n.id) ?? ""),
    ].join("\n\n"),
  }
}
