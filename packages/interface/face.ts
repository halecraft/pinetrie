// interface/face — a card at its least detail (ADR-0126): a folded column's
// strip, a grid's cell, and later a mark in a margin. One union, a case per
// kind that is drawn, so every surface that draws a face draws the same
// value. Its frame (tone, state, actions) is the place's (`card-frame.ts`);
// what is here is the kind's. Pure: `faceOf` decides it, `textFaceWords`
// words a text card's, and `RENDERINGS` (`packages/web/renderings.tsx`)
// draws each.

import type {
  CardCommand,
  CardId,
  CardPlace,
  CardRecord,
  FactCardId,
  NoteColumnId,
  QueuedFact,
  TextCardId,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { commandOf } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import type { CardTone } from "./card-frame.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import type { Reader } from "./send.ts"
import { bareThreadFace, type ThreadFace } from "./thread-face.ts"

/** The kinds of card that are drawn: those with a record. */
export type DrawnKind = CardRecord["kind"]

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

/** A fact's face (ADR-0126): the fact, worded by `factLine`. */
export interface FactFace {
  readonly kind: "fact"
  readonly card: FactCardId
  readonly fact: QueuedFact
}

/** A card at its least detail, by kind. */
export type Face = TextFace | ThreadFace | NoteColumnFace | FactFace

/** The face of a card of `K`. */
export type FaceOf<K extends DrawnKind> = Extract<Face, { readonly kind: K }>

/** The card a face draws. */
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
export function faceOf(card: CardRecord, facts: FaceFacts): Face {
  switch (card.kind) {
    case "text":
      return {
        kind: "text",
        card: card.id,
        tone: facts.tone,
        owner: card.owner,
        command: commandOf(card),
        lines: firstLines(facts.texts.get(card.id) ?? ""),
        key: facts.key,
      }
    case "thread":
      return facts.threads.get(card.id) ?? bareThreadFace(card.id)
    case "note-column":
      return noteColumnFace(card.id, facts.notes)
    case "fact":
      return { kind: "fact", card: card.id, fact: card.content.fact }
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
 * Each kind's icon (ADR-0126): a card's icon and shape say its kind, and its
 * frame's colour its place, so the two never cross.
 */
export const KIND_ICON: Readonly<Record<DrawnKind, string>> = {
  text: "✎",
  thread: "≡",
  "note-column": "▤",
  fact: "※",
}

/** A text card's face in words: its command's chip, and whose it is. */
export interface TextFaceWords {
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

// ── levels of detail (ADR-0126, *Renderings*) ─────────────────────────────

/**
 * How much of a card is drawn: a face (a strip, a cell, a mark), normal (the
 * card itself, bounded) or whole (all of it, as a column or opened).
 */
export type Detail = "face" | "normal" | "whole"

/**
 * The level each place draws its cards at (ADR-0126's table), total, so a
 * new place does not compile until it says how its cards draw. A dock and a
 * list draw normal, a canvas whole, an inventory faces in its grid (its
 * selected card normal in the preview, and whole when opened). A discarded
 * card is drawn nowhere; were it drawn, it would be a face.
 */
export const DETAIL_ON: Readonly<Record<CardPlace["kind"], Detail>> = {
  composing: "normal",
  pinned: "normal",
  queued: "normal",
  note: "normal",
  "task-pinned": "normal",
  canvas: "whole",
  fresh: "whole",
  inventory: "face",
  gone: "face",
}

/** The level a card at a place of `place` is drawn at: a folded column is a face. */
export const detailOf = (place: CardPlace["kind"], folded: boolean): Detail =>
  folded ? "face" : DETAIL_ON[place]
