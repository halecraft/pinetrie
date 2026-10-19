// card-ids — each kind of card's id, and a card's kind from its id. A card's
// id's prefix is its kind's (`KINDS`): this module reads `KINDS`' value, and
// `kinds.ts` imports only types from here, so the two never load in a cycle.

import {
  type CanvasId,
  isCanvasId,
  isThreadId,
  type ThreadId,
} from "@pinetrie/core"
import { KINDS } from "./kinds.ts"

declare const textCardIdBrand: unique symbol
/**
 * A text card's id, a bare uuidv7: the key of its record and the name of its
 * text's document.
 */
export type TextCardId = string & { readonly [textCardIdBrand]: true }
export const textCardId = (id: string): TextCardId => id as TextCardId

declare const noteColumnIdBrand: unique symbol
/**
 * A note column's id: `n-` and a uuidv7, minted by the page that makes the
 * column (`newNoteColumnId`, `@pinetrie/session`) or by the host that makes one
 * for a note with nowhere to go (`nearestNoteColumn`).
 */
export type NoteColumnId = string & { readonly [noteColumnIdBrand]: true }

/** Whether text names a note column: the check wherever one is read. */
export const isNoteColumnId = (s: string): s is NoteColumnId =>
  s.startsWith(KINDS["note-column"].prefix) &&
  s.length > KINDS["note-column"].prefix.length
declare const mediaIdBrand: unique symbol
/** A media column's id: `m-` and a uuidv7. */
export type MediaId = string & { readonly [mediaIdBrand]: true }

/** Whether text names a media column. */
export const isMediaId = (s: string): s is MediaId =>
  s.startsWith(KINDS.media.prefix) && s.length > KINDS.media.prefix.length

declare const imageIdBrand: unique symbol
/** An image's id: `i-` and a uuidv7, minted by the page or the host that puts it. */
export type ImageId = string & { readonly [imageIdBrand]: true }

/** Whether text names an image. */
export const isImageId = (s: string): s is ImageId =>
  s.startsWith(KINDS.image.prefix) && s.length > KINDS.image.prefix.length
declare const fileCardIdBrand: unique symbol
/** A file card's id: `f-` and a uuidv7. */
type FileCardId = string & { readonly [fileCardIdBrand]: true }
declare const factCardIdBrand: unique symbol
/**
 * A fact card's id: `x-` and a uuidv7, minted by the host as it queues the fact
 * (`f-` is a file card's).
 */
export type FactCardId = string & { readonly [factCardIdBrand]: true }

declare const referenceCardIdBrand: unique symbol
/**
 * A reference card's id: `q-` and a uuidv7, minted by the page that takes it
 * (`a-` is an ask's, `r-` a root's).
 */
export type ReferenceCardId = string & {
  readonly [referenceCardIdBrand]: true
}

declare const askCardIdBrand: unique symbol
/**
 * An ask card's id: `a-` and a uuidv7, minted by the host as it queues an ask
 * for a busy agent.
 */
export type AskCardId = string & { readonly [askCardIdBrand]: true }

/**
 * Any card's id: the key of its record in the places document. Its kind is
 * its prefix (`kindOfCard`, `KINDS`), so no record stores a kind that could
 * disagree with its id.
 */
export type CardId =
  | TextCardId
  | ThreadId
  | CanvasId
  | NoteColumnId
  | FactCardId
  | ReferenceCardId
  | AskCardId
  | MediaId
  | ImageId
  | FileCardId

/** What a card is, from its id (`KINDS`). */
export type CardKind =
  | "text"
  | "thread"
  | "canvas"
  | "note-column"
  | "fact"
  | "reference"
  | "ask"
  | "media"
  | "image"
  | "file"

/** The id of a card of `K`. */
export type IdOf<K extends CardKind> = {
  readonly text: TextCardId
  readonly thread: ThreadId
  readonly canvas: CanvasId
  readonly "note-column": NoteColumnId
  readonly fact: FactCardId
  readonly reference: ReferenceCardId
  readonly ask: AskCardId
  readonly media: MediaId
  readonly image: ImageId
  readonly file: FileCardId
}[K]

/** Each prefixed kind's prefix, from `KINDS`. */
const CARD_PREFIXES: readonly (readonly [string, CardKind])[] = Object.entries(
  KINDS,
).flatMap(([kind, spec]) =>
  spec.prefix === null ? [] : [[spec.prefix, kind as CardKind] as const],
)

/**
 * A card of `kind`'s id from the text after its prefix (`KINDS`), a uuidv7
 * where it is minted: for minters, fixtures and parsers.
 */
export const cardIdOfKind = <K extends CardKind>(
  kind: K,
  rest: string,
): IdOf<K> => `${KINDS[kind].prefix ?? ""}${rest}` as IdOf<K>

/** A card's kind, read from its id's prefix (`KINDS`): a bare id is a text card's. */
export const kindOfCard = (id: CardId): CardKind =>
  CARD_PREFIXES.find(([p]) => id.startsWith(p))?.[1] ?? "text"

/** A card's id with its kind (`kindOfCard`), so a switch on one narrows the other. */
type KindedId = {
  [K in CardKind]: { readonly kind: K; readonly id: IdOf<K> }
}[CardKind]

/** `id` with its kind, read from its prefix (`KINDS`). */
export const kindedId = (id: CardId): KindedId =>
  ({ kind: kindOfCard(id), id }) as KindedId

export const isReferenceCardId = (id: CardId): id is ReferenceCardId =>
  kindOfCard(id) === "reference"

/** Whether a card's id is a text card's, which has a text document. */
export const isTextCardId = (id: CardId): id is TextCardId =>
  kindOfCard(id) === "text"

const UUIDV7 =
  "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const TEXT_CARD_RE = new RegExp(`^${UUIDV7}$`)
const PREFIXED_CARD_RE = new RegExp(
  `^(?:${CARD_PREFIXES.map(([p]) => p).join("|")})${UUIDV7}$`,
)

/**
 * A card's id as it comes in from the wire or the store; undefined for text
 * that is none. A text card's is a bare lowercase uuidv7; a note column's, a
 * fact's, a reference's, an ask's, a media column's, an image's and a file
 * card's are their prefix and one. A thread's is any id `isThreadId` takes, as everywhere a
 * thread is read, so a thread the store names is never dropped for its id's
 * shape; a canvas's, any `isCanvasId` takes, the same way. The one way text becomes
 * a `CardId` outside a minter.
 */
export function parseCardId(id: string): CardId | undefined {
  if (isThreadId(id)) return id
  if (isCanvasId(id)) return id
  if (TEXT_CARD_RE.test(id)) return id as TextCardId
  return PREFIXED_CARD_RE.test(id) ? (id as CardId) : undefined
}

/** A text card's id as it comes in (`parseCardId`); undefined for any other. */
export const parseTextCardId = (id: string): TextCardId | undefined =>
  TEXT_CARD_RE.test(id) ? (id as TextCardId) : undefined
