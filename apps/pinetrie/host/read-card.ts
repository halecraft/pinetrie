// host/read-card — `read_card`'s answer: gather the places, the cards'
// titles and, for a note column, its notes' texts; plan what is read
// (`planCardRead`); then read an image's bytes from the blob store, which
// the tool hands the model.

import {
  type BlobStore,
  type CardId,
  isNoteColumnId,
  type ThreadId,
} from "@pinetrie/core"
import type { CardReadAnswer } from "@pinetrie/pi"
import { readCardTitles, readPlaces } from "@pinetrie/reads"
import { notesIn, planCardRead } from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"

export function createReadCard(deps: {
  readonly basics: Pick<Basics, "places" | "session">
  readonly cards: Pick<CardPort, "hydrate" | "textNow">
  readonly blobs: Pick<BlobStore, "get">
}): (
  lane: ThreadId,
  card: string,
  version: number | null,
) => Promise<CardReadAnswer> {
  const { places, session } = deps.basics
  return async (lane, card, version) => {
    // gather: a note column's notes' texts, loaded first
    const id = card.trim()
    const before = readPlaces(places)
    const notes = isNoteColumnId(id) ? notesIn(before, id) : []
    await deps.cards.hydrate(notes.map(n => n.id))
    const noteTexts = new Map<CardId, string>(
      notes.map(n => [n.id, deps.cards.textNow(n.id)] as const),
    )
    // plan
    const read = planCardRead({
      card: id,
      version,
      thread: lane,
      cards: readPlaces(places),
      titles: readCardTitles(session),
      noteTexts,
    })
    // execute: an image's bytes
    if (read.kind !== "image") return { text: read.text, image: null }
    const blob = deps.blobs.get(read.sha256)
    return blob === undefined
      ? { text: `${read.text} Its image is no longer stored.`, image: null }
      : {
          text: read.text,
          image: {
            data: Buffer.from(blob.bytes).toString("base64"),
            mimeType: blob.mimeType,
          },
        }
  }
}
