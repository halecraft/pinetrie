// interface/face — a card at its least detail: a folded column's strip, a
// grid's cell, a mark in a margin. One union, a case per kind that is drawn,
// so every surface that draws a face draws the same value.

import type {
  Address,
  AskCardId,
  CardCommand,
  CardId,
  CardPlace,
  CardRecord,
  FactCardId,
  NoteColumnId,
  QueuedFact,
  ReferenceCardId,
  RelayDetails,
  Sha256,
  TextCardId,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { cardCommand } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import type { CardTone } from "./card-frame.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import type { Reader } from "./send.ts"
import { bareThreadFace, type ThreadFace } from "./thread-face.ts"

/**
 * The cards drawn by their kind's renderings: every one with a record but
 * a canvas's, which the board draws (`boardView`).
 */
export type DrawnCard = Exclude<CardRecord, { readonly kind: "canvas" }>

/** The kinds of card drawn by their renderings (`DrawnCard`). */
export type DrawnKind = DrawnCard["kind"]

/** A text card's face: its place's colour, its owner, its first lines. */
export interface TextFace {
  readonly kind: "text"
  readonly card: TextCardId
  readonly tone: CardTone
  readonly owner: WriterId
  readonly command: CardCommand | null
  /** Its first three lines, leading blank lines left out. */
  readonly lines: string
  /** The inventory's 1–9 for its slot; null elsewhere. */
  readonly key: string | null
}

/** A note column's face: its title, and how many notes it holds. */
export interface NoteColumnFace {
  readonly kind: "note-column"
  readonly card: NoteColumnId
  readonly title: string
  /** How many notes it holds; null before the tab has read them. */
  readonly notes: number | null
}

/** A fact's face: the fact, worded by `factLine`. */
export interface FactFace {
  readonly kind: "fact"
  readonly card: FactCardId
  readonly fact: QueuedFact
}

/** A reference's face: a chip naming what it names. */
export interface ReferenceFace {
  readonly kind: "reference"
  readonly card: ReferenceCardId
  readonly address: Address
  readonly quote: Sha256
  /** The inventory's 1–9 for its slot; null elsewhere. */
  readonly key: string | null
}

/** An ask card's face: the ask relayed, worded by `askLine`. */
export interface AskFace {
  readonly kind: "ask"
  readonly card: AskCardId
  readonly relay: RelayDetails
}

/** A card at its least detail, by kind. */
export type Face =
  | TextFace
  | ThreadFace
  | NoteColumnFace
  | FactFace
  | ReferenceFace
  | AskFace

export type FaceOf<K extends DrawnKind> = Extract<Face, { readonly kind: K }>

export const cardOfFace = (face: Face): CardId =>
  face.kind === "thread" ? face.thread : face.card

/** What a face is decided from; each map holds what this tab has read. */
export interface FaceFacts {
  /** The colour of the place it is drawn at (`cardFrame`'s tone). */
  readonly tone: CardTone
  /** Its slot's 1–9 in your inventory; null elsewhere. */
  readonly key: string | null
  /** Each text card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's face; one without is drawn by its id alone. */
  readonly threads: ReadonlyMap<ThreadId, ThreadFace>
  /** Each note column, as its column draws it. */
  readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
}

/** A text card's first three lines, leading blank lines left out. */
const firstLines = (text: string): string =>
  text.trimStart().split("\n").slice(0, 3).join("\n").trimEnd()

/** `card` at its least detail. */
export function cardFace(card: DrawnCard, facts: FaceFacts): Face {
  switch (card.kind) {
    case "text":
      return {
        kind: "text",
        card: card.id,
        tone: facts.tone,
        owner: card.owner,
        command: cardCommand(card),
        lines: firstLines(facts.texts.get(card.id) ?? ""),
        key: facts.key,
      }
    case "thread":
      return facts.threads.get(card.id) ?? bareThreadFace(card.id)
    case "note-column":
      return noteColumnFace(card.id, facts.notes)
    case "fact":
      return { kind: "fact", card: card.id, fact: card.content.fact }
    case "reference":
      return {
        kind: "reference",
        card: card.id,
        address: card.content.address,
        quote: card.content.quote,
        key: facts.key,
      }
    case "ask":
      return { kind: "ask", card: card.id, relay: card.content.relay }
  }
}

/** A note column's face, from its column as drawn. */
export function noteColumnFace(
  card: NoteColumnId,
  notes: ReadonlyMap<NoteColumnId, NoteColumnView>,
): NoteColumnFace {
  const view = notes.get(card)
  return {
    kind: "note-column",
    card,
    title: view?.title ?? "",
    notes: view?.notes.length ?? null,
  }
}

/**
 * Each kind's icon: a card's icon and shape say its kind, and its
 * frame's colour its place, so the two never cross.
 */
export const KIND_ICON: Readonly<Record<DrawnKind, string>> = {
  text: "✎",
  thread: "≡",
  "note-column": "▤",
  fact: "※",
  reference: "❝",
  ask: "⇢",
}

/** A text card's face in words: its command's chip, and whose it is. */
interface TextFaceWords {
  readonly command: string | null
  /** Whose it is, for its title and its avatar's label. */
  readonly owner: string
}

export const textFaceWords = (
  face: TextFace,
  reader: Reader,
): TextFaceWords => ({
  command: face.command === null ? null : COMMAND_CHIP[face.command],
  owner:
    face.owner === reader.me
      ? "you"
      : displayName(face.owner, reader.nameOf.get(face.owner)),
})

/** A command on a face: short, since a face has no thread to name (`commandWords` has). */
const COMMAND_CHIP: Readonly<Record<CardCommand, string>> = {
  "bring-up-to-date": "catch up",
  "continue-on-accepted": "continue",
  "catch-up-with-parent": "catch up with parent",
  split: "split",
}

// ── levels of detail ──────────────────────────────────────────────────────

/**
 * How much of a card is drawn: a face (a strip, a cell, a mark), normal (the
 * card itself, bounded) or whole (all of it, as a column or opened).
 */
export type Detail = "face" | "normal" | "whole"

/**
 * The level each place draws its cards at total, so a
 * new place does not compile until it says how its cards draw. A dock and a
 * list draw normal, a canvas whole, an inventory faces in its grid (its
 * selected card normal in the preview, and whole when opened). An entry's
 * margin draws its comments normal under the entry while it is open, and a
 * face, their count, while it is shut (`cardDetail`). The board draws its
 * canvas cards as faces. A discarded card is drawn nowhere; were it drawn,
 * it would be a face.
 */
export const DETAIL_ON: Readonly<Record<CardPlace["kind"], Detail>> = {
  composing: "normal",
  pinned: "normal",
  queued: "normal",
  note: "normal",
  margin: "normal",
  "canvas-pinned": "normal",
  canvas: "whole",
  inventory: "face",
  board: "face",
  trash: "face",
}

/** The level a card at a place of `place` is drawn at: a folded column, or a shut margin, is a face. */
export const cardDetail = (
  place: CardPlace["kind"],
  folded: boolean,
): Detail => (folded ? "face" : DETAIL_ON[place])
