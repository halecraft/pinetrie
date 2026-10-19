// card — a card's record and where it sits.

import {
  asPlaceFields,
  CARD_COMMANDS,
  type Card,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  type ContentOf,
  type EntryId,
  type IdOf,
  type ImageVersion,
  isImageMime,
  isSha256,
  isTextCard,
  kindedId,
  NO_CONTENT,
  type OrderedPlace,
  type PlacedKind,
  parseAddress,
  parseCardId,
  placeFields,
  placeOfFields,
  placeOfKind,
  printAddress,
  type TextCard,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeQueuedFact, encodeQueuedFact } from "./fact.ts"
import { decodeStoredRelay, encodeRelay } from "./relay-codec.ts"

/**
 * A card as the places document stores it: flat strings, "" for none. The
 * host writes a record whole, so every field is there.
 */
const StoredCard = Type.Object({
  owner: Type.String({ minLength: 1 }),
  kind: Type.String(),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
  order: Type.String(),
  by: Type.String(),
  seen: Type.String(),
  command: Type.String(),
  /** A fact the card carries, as JSON; absent before facts were. */
  fact: Type.Optional(Type.String()),
  /** An ask card's relay, as JSON; absent before it had its own. */
  relay: Type.Optional(Type.String()),
  unsent: Type.String(),
  placer: Type.String({ minLength: 1 }),
  holder: Type.String(),
  /** A canvas or trashed card's canvas; absent before canvases. */
  canvas: Type.Optional(Type.String()),
  /** A canvas card's width; absent before canvases. */
  width: Type.Optional(Type.String()),
  /** A canvas's card's workflow state; absent before canvases were cards. */
  state: Type.Optional(Type.String()),
  /** A reference's address, printed; absent before references. */
  address: Type.Optional(Type.String()),
  /** A reference's quote's blob; absent before references. */
  quote: Type.Optional(Type.String()),
  /** A text card's origin, a printed address, "" for none; absent before origins. */
  origin: Type.Optional(Type.String()),
  /** An image's versions, as JSON; absent before images. */
  versions: Type.Optional(Type.String()),
})

/** The flat value the places document stores under a card's id. */
interface StoredCardFields {
  readonly owner: string
  readonly kind: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly command: string
  readonly fact: string
  readonly relay: string
  readonly unsent: string
  readonly placer: string
  readonly holder: string
  readonly canvas: string
  readonly width: string
  readonly state: string
  readonly address: string
  readonly quote: string
  readonly origin: string
  readonly versions: string
}

const isCommand = (s: string): s is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(s)

/** The columns a card's content is stored in: "" for none. */
type ContentFields = Pick<
  StoredCardFields,
  | "command"
  | "fact"
  | "relay"
  | "unsent"
  | "address"
  | "quote"
  | "origin"
  | "versions"
>

type ContentColumn = keyof ContentFields

const NO_CONTENT_FIELDS: ContentFields = {
  command: "",
  fact: "",
  relay: "",
  unsent: "",
  address: "",
  quote: "",
  origin: "",
  versions: "",
}

/** How one kind's content is stored: the columns it holds, and their codec. */
interface ContentCodec<K extends PlacedKind> {
  /** The columns it holds: a row holding any other is another kind's, refused. */
  readonly columns: readonly ContentColumn[]
  readonly encode: (content: ContentOf[K]) => Partial<ContentFields>
  /** Its columns -> its content; undefined for a value this build cannot read. */
  readonly decode: (fields: ContentFields) => ContentOf[K] | undefined
}

/**
 * Each kind's content as the places document stores it: a row
 * per kind with records, so a kind without one does not compile.
 */
export const CARD_CODEC: { readonly [K in PlacedKind]: ContentCodec<K> } = {
  text: {
    columns: ["command", "unsent", "origin"],
    encode: c => ({
      command: c.command ?? "",
      unsent: c.unsent ?? "",
      origin: c.origin === null ? "" : printAddress(c.origin),
    }),
    decode: f => {
      const origin = f.origin === "" ? null : parseAddress(f.origin)
      if (origin === undefined) return undefined
      const { command } = f
      if (command !== "" && !isCommand(command)) return undefined
      return {
        command: command === "" ? null : command,
        unsent: f.unsent === "" ? null : f.unsent,
        origin,
      }
    },
  },
  reference: {
    columns: ["address", "quote"],
    encode: c => ({ address: printAddress(c.address), quote: c.quote }),
    decode: f => {
      const address = parseAddress(f.address)
      return address === undefined || !isSha256(f.quote)
        ? undefined
        : { address, quote: f.quote }
    },
  },
  thread: { columns: [], encode: () => ({}), decode: () => NO_CONTENT },
  canvas: { columns: [], encode: () => ({}), decode: () => NO_CONTENT },
  "note-column": { columns: [], encode: () => ({}), decode: () => NO_CONTENT },
  fact: {
    columns: ["fact"],
    encode: c => ({ fact: encodeQueuedFact(c.fact) }),
    decode: f => {
      const fact = decodeQueuedFact(f.fact)
      return fact === undefined ? undefined : { fact }
    },
  },
  ask: {
    columns: ["relay"],
    encode: c => ({ relay: encodeRelay(c.relay) }),
    decode: f => {
      const relay = decodeStoredRelay(f.relay)
      return relay === undefined ? undefined : { relay }
    },
  },
  media: { columns: [], encode: () => ({}), decode: () => NO_CONTENT },
  image: {
    columns: ["versions"],
    encode: c => ({ versions: JSON.stringify(c.versions) }),
    decode: f => {
      const versions = decodeVersions(f.versions)
      return versions === undefined ? undefined : { versions }
    },
  },
}

const StoredVersions = Type.Array(
  Type.Object({
    sha256: Type.String(),
    original: Type.String(),
    mimeType: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
    by: Type.String({ minLength: 1 }),
    at: Type.Number(),
  }),
  { minItems: 1 },
)

/** An image's stored versions; undefined for none, or any not a blob's. */
function decodeVersions(json: string): readonly ImageVersion[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  return decodeWith(StoredVersions, parsed, vs => {
    const out: ImageVersion[] = []
    for (const v of vs) {
      const { sha256, original, mimeType } = v
      if (!isSha256(sha256) || !isSha256(original) || !isImageMime(mimeType))
        return undefined
      out.push({ ...v, sha256, original, mimeType, by: v.by as WriterId })
    }
    return out
  })
}

/** A card's content as its columns (`CARD_CODEC`), every other one "". */
const contentFields = <K extends PlacedKind>(card: {
  readonly kind: K
  readonly content: ContentOf[K]
}): ContentFields => {
  const codec: ContentCodec<K> = CARD_CODEC[card.kind]
  return { ...NO_CONTENT_FIELDS, ...codec.encode(card.content) }
}

/**
 * A card record -> the flat value the places document stores under its id:
 * its place's fields (`placeFields`) and its content's (`CARD_CODEC`).
 */
export const encodeCard = (card: CardRecord): StoredCardFields => ({
  owner: card.owner,
  placer: card.placer,
  ...placeFields(card.place),
  ...contentFields(card),
})

/**
 * A kind's content from a stored row; undefined when the row holds a column
 * that is not the kind's (`CARD_CODEC`' `columns`), or one its codec cannot
 * read.
 */
const decodeContent = <K extends PlacedKind>(
  kind: K,
  fields: ContentFields,
): ContentOf[K] | undefined => {
  const codec: ContentCodec<K> = CARD_CODEC[kind]
  const foreign = (Object.keys(fields) as ContentColumn[]).some(
    column => fields[column] !== "" && !codec.columns.includes(column),
  )
  return foreign ? undefined : codec.decode(fields)
}

/**
 * A card of `kind` at `place`, from its stored row; undefined for a place
 * its kind is never in (`placeOfKind`) or content it cannot hold.
 */
const decodeOfKind = <K extends PlacedKind>(
  kind: K,
  id: IdOf<K>,
  row: { readonly owner: WriterId; readonly placer: WriterId },
  place: CardPlace,
  fields: ContentFields,
): Card<K> | undefined => {
  const at = placeOfKind(kind, place)
  const content = decodeContent(kind, fields)
  return at === undefined || content === undefined
    ? undefined
    : { kind, id, owner: row.owner, placer: row.placer, place: at, content }
}

/**
 * A stored card -> its record, of the kind its id says (`kindedId`);
 * undefined for one that is malformed, in a place its kind is never in,
 * with content its kind does not hold or this build cannot read
 * (`CARD_CODEC`), or of a kind this build holds no records of yet. Total.
 * Where it is is read by core's `placeOfFields`, as a move's key on the
 * wire is by `keyOfFields`.
 */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const place = placeOfFields(asPlaceFields(c))
    const card = parseCardId(id)
    if (place === undefined || card === undefined) return undefined
    const row = { owner: c.owner as WriterId, placer: c.placer as WriterId }
    const fields: ContentFields = {
      command: c.command,
      fact: c.fact ?? "",
      relay: c.relay ?? "",
      unsent: c.unsent,
      address: c.address ?? "",
      quote: c.quote ?? "",
      origin: c.origin ?? "",
      versions: c.versions ?? "",
    }
    const of = kindedId(card)
    switch (of.kind) {
      case "text":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "thread":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "canvas":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "note-column":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "fact":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "reference":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "ask":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "media":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "image":
        return decodeOfKind(of.kind, of.id, row, place, fields)
      case "file":
        return undefined
      default:
        return of satisfies never
    }
  })

/**
 * Where a place at a thread resolves now: its thread's end (`threadEnd`), so
 * it follows its thread as the thread grows. Null when the thread has no
 * entry this index holds.
 */
export const placeEnd = (
  place: { readonly thread: ThreadId },
  index: TreeIndex,
): EntryId | null => threadEnd(index, place.thread)

/**
 * Your message's thread end now; null for any other card, or a
 * place gone. A pinned card's end is `cardsAt`'s alone: resolved here, it
 * could take your composer (`yourCard`).
 */
export const cardEnd = (card: CardRecord, index: TreeIndex): EntryId | null =>
  card.place.kind === "composing" ? placeEnd(card.place, index) : null

/**
 * Everyone's pinned cards whose thread ends at `end`: by `order`, then by
 * id, so oldest first. The one way a pinned card's end is resolved:
 * `cardEnd` stays your message's alone, so none is ever bound to a composer
 * (`yourCard`).
 */
export function pinnedCardsAtEnd(
  end: EntryId,
  cards: readonly CardRecord[],
  index: TreeIndex,
): readonly TextCard[] {
  return cards
    .filter(isTextCard)
    .filter(c => c.place.kind === "pinned" && placeEnd(c.place, index) === end)
    .sort(byOrder)
}

/** Whether `place` has a rank among its neighbours. */
export const isOrdered = (place: CardPlace): place is OrderedPlace =>
  "order" in place

/** The order of a place that has one, else "". */
export const cardOrder = (c: CardRecord): string =>
  isOrdered(c.place) ? c.place.order : ""

/** By `order`, then by id. */
export const byOrder = (a: CardRecord, b: CardRecord): number => {
  const [x, y] = [cardOrder(a), cardOrder(b)]
  if (x !== y) return x < y ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Where a column's composer is: a thread's end, or a thread not yet started,
 * which has no end yet.
 */
type CardWhere =
  | { readonly kind: "end"; readonly end: EntryId }
  | { readonly kind: "thread"; readonly thread: ThreadId }

/**
 * Your message where a column's composer is; never another
 * writer's, and never a note. Of several at one end, the newest (ids are
 * uuidv7).
 */
export function yourCard(
  me: WriterId,
  where: CardWhere,
  cards: readonly CardRecord[],
  index: TreeIndex,
): TextCard | undefined {
  let found: TextCard | undefined
  for (const c of cards.filter(isTextCard)) {
    if (c.owner !== me) continue
    const here =
      where.kind === "end"
        ? cardEnd(c, index) === where.end
        : c.place.kind === "composing" && c.place.thread === where.thread
    if (here && (found === undefined || c.id > found.id)) found = c
  }
  return found
}

/**
 * What a starting host deletes: text cards whose text is empty and that
 * carry no command, and stored `card:` documents with no record. Only a
 * text card's words are a document (`KINDS`' `text`), so no other kind is
 * swept for its lack of one. A swept card's own document is not among
 * `docs`: the change that removes its record destroys it.
 */
export function planCardSweep(input: {
  readonly cards: readonly CardRecord[]
  /** Each card's text, by id; a card with no text gathered is empty. */
  readonly texts: ReadonlyMap<CardId, string>
  /** Every stored `card:` document id. */
  readonly stored: readonly string[]
  readonly cardOfDoc: (docId: string) => CardId | undefined
}): { readonly records: CardId[]; readonly docs: string[] } {
  const records = input.cards
    .filter(isTextCard)
    .filter(
      c => c.content.command === null && (input.texts.get(c.id) ?? "") === "",
    )
    .map(c => c.id)
  const held = new Set<string>(input.cards.map(c => c.id))
  const docs = input.stored.filter(docId => {
    const id = input.cardOfDoc(docId)
    return id !== undefined && !held.has(id)
  })
  return { records, docs }
}
