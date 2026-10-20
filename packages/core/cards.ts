// cards — what a card is: an identity, one place and content; each kind's
// content, the one maker of a record (`makeCard`), where a card's words are
// read (`cardTextSource`) and a text card's commands. Where cards are, and how
// they move, is `places.ts`'.

import type { Address } from "./address.ts"
import type { LatestFrom } from "./bases.ts"
import type {
  AllowanceSpentFact,
  BranchedFact,
  MemberFact,
  RoundFact,
  StopFact,
  UnansweredFact,
  UndeliveredFact,
} from "./facts.ts"
import type { ConflictChoice } from "./folder.ts"
import type { TextCardId, ThreadId, WriterId } from "./ids.ts"
import type { ImageRef, Sha256 } from "./images.ts"
import type { RelayDetails } from "./mentions.ts"
import type { IdOf, PlaceOf } from "./places.ts"

/**
 * The commands that catch a thread up. The first two bring the thread up to
 * date with its base, `continue-on-accepted` moving a thread whose WIP is gone
 * to accepted work first; `get-latest-from-parent` merges the thread it branched
 * from.
 */
export type GetLatestCommand =
  | "get-latest"
  | "continue-on-accepted"
  | "get-latest-from-parent"
export const GET_LATEST_COMMANDS: readonly GetLatestCommand[] = [
  "get-latest",
  "continue-on-accepted",
  "get-latest-from-parent",
]

/**
 * A command a card is sent through; a plain card has none. The catch-up
 * commands, and `split`, which splits the thread's proposed changes into a
 * stack in a run of its own, its text the person's intent.
 */
export type CardCommand = GetLatestCommand | "split"
export const CARD_COMMANDS: readonly CardCommand[] = [
  ...GET_LATEST_COMMANDS,
  "split",
]

/** Whether `command` catches the thread up, rather than doing something else. */
export const isGetLatest = (
  command: CardCommand,
): command is GetLatestCommand =>
  (GET_LATEST_COMMANDS as readonly string[]).includes(command)

/**
 * What a command on a thread's proposed changes did, as a fact in the thread:
 * an acceptance, with the change it was added as, the bookmark it moved and
 * what that bookmark is to the thread, or into a folder project's folder
 * with how many files it wrote; or a description asked for again, a
 * squash, a refresh. `by` is who asked.
 */
export type ProposedChangesFact =
  | {
      readonly kind: "accepted"
      readonly lane: ThreadId
      readonly by: WriterId
      /** The change id the proposed changes were added as. */
      readonly as: string
      readonly bookmark: string
      readonly to: LatestFrom
    }
  /** A folder project's accept: the files it wrote into the project's folder. */
  | {
      readonly kind: "accepted-into-folder"
      readonly lane: ThreadId
      readonly by: WriterId
      readonly files: number
    }
  | {
      readonly kind: "described" | "squashed" | "refreshed"
      readonly lane: ThreadId
      readonly by: WriterId
    }

/** A person's choice of a version of a folder lane's conflicted path: the conflict closed. */
export interface ResolvedFact {
  readonly kind: "resolved"
  readonly lane: ThreadId
  readonly by: WriterId
  readonly path: string
  readonly choose: ConflictChoice
}

/**
 * A fact on its way into its thread: what a fact card holds, appended as an
 * entry when the thread's end consumes it. What a command on the proposed
 * changes did, a conflict's version a person chose, who stopped a run, a
 * member dismissed or gone, a budget spent,
 * an ask unanswered or an answer undelivered, a round's line for people, or a
 * proposal's branches opened.
 */
export type QueuedFact =
  | ProposedChangesFact
  | ResolvedFact
  | StopFact
  | MemberFact
  | AllowanceSpentFact
  | UnansweredFact
  | UndeliveredFact
  | RoundFact
  | BranchedFact

/** A card's command, or null: only a text card has one. */
export const cardCommand = (card: CardRecord): CardCommand | null =>
  card.kind === "text" ? card.content.command : null

/**
 * What each kind of card holds, beside its identity and its place: a new kind
 * is a row here, one in `KINDS`, and one in the page's `RENDERINGS`.
 *
 * - A text card: the command it is sent through when popped, and why the host
 *   could not send it, until it is queued again (null when it never failed).
 *   Its text is its own document; who wrote in it is read from that document's
 *   operations (`writersOfClients`), never stored.
 * - A thread's card: nothing; its id is its thread's.
 * - A note column or a media column: nothing here; its title is the host's
 *   record (`CARD_TITLE`, absent while untitled), and its notes or images are
 *   cards whose place names it.
 * - An image: its versions, oldest first, never empty; the newest is drawn.
 *   Its title is the host's record too.
 * - A fact: the fact, appended to its thread as the thread's end consumes it.
 * - A reference: an address, and the quote of what it names, kept as a blob:
 *   the past never changes, so the quote is exact, and the reference draws
 *   without loading its referent's root.
 */
/**
 * What a card that is a canvas's column holds: a box anyone who may change
 * the canvas ticks, for everyone. It means what they mean, and moves with
 * the card.
 */
export interface ColumnContent {
  readonly ticked: boolean
}

export interface ContentOf {
  readonly text: {
    readonly command: CardCommand | null
    readonly unsent: string | null
    /** Where it was copied from: a reference edited as text; null for none. */
    readonly origin: Address | null
  }
  readonly reference: {
    /** What it names. */
    readonly address: Address
    /** Its quote's blob: the markdown of what it names, which never changes. */
    readonly quote: Sha256
  }
  readonly thread: ColumnContent
  readonly canvas: Readonly<Record<string, never>>
  readonly "note-column": ColumnContent
  readonly fact: { readonly fact: QueuedFact }
  readonly ask: { readonly relay: RelayDetails }
  readonly media: ColumnContent
  readonly image: { readonly versions: readonly ImageVersion[] }
}

/**
 * One version of an image: the copy drawn, fitted as every stored image is,
 * with its type and size, so a column holds its box before its bytes load;
 * the image as it came (`original`, the copy itself when nothing was
 * fitted); who added it and when. The host appends them, so two added at
 * once both land, in the order it took them.
 */
export interface ImageVersion extends ImageRef {
  readonly original: Sha256
  readonly by: WriterId
  readonly at: number
}

/** The kinds of card with records: the reserved `file` has none yet. */
export type PlacedKind = keyof ContentOf

/**
 * A card: an identity, one place, and content. Its record is in the places
 * document, which only the host writes. Its kind is its id's (`kindOfCard`),
 * never stored.
 */
export interface Card<K extends PlacedKind> {
  readonly kind: K
  readonly id: IdOf<K>
  /** Who made it: whose composer it is, who started its thread, who acted. */
  readonly owner: WriterId
  /**
   * Who put it where it is: the sender of the last move the host accepted. A
   * write the host makes itself (a popped card written back when refused) keeps
   * it. When someone else moves the card, the trace is for them.
   */
  readonly placer: WriterId
  readonly place: PlaceOf<K>
  readonly content: ContentOf[K]
}

/** A text card's record. */
export type TextCard = Card<"text">

/** A thread's card: its id is its thread's, and it has no text. */
export type ThreadCard = Card<"thread">

/**
 * A canvas's card: its id is its canvas's, it has no text, and it is on the board,
 * in a workflow state, until the host trashes it.
 */
export type CanvasCard = Card<"canvas">

/** A note column's card, on a canvas alone. */
export type NoteColumnCard = Card<"note-column">

/** A fact on its way into its thread: only ever queued. */
export type FactCard = Card<"fact">

/** A reference to an address. */
export type ReferenceCard = Card<"reference">

/** A media column's card: on a canvas, in an inventory or in a trash. */
export type MediaCard = Card<"media">

/** An image's card: in a media column or in a trash. */
export type ImageCard = Card<"image">

/** The version of `image` drawn: its newest. */
export const shownVersion = (image: ImageCard): ImageVersion | undefined =>
  image.content.versions.at(-1)

/**
 * A card's record, by kind, so a text card on a canvas, a thread's card in a
 * queue or a fact anywhere but a queue does not compile.
 */
export type CardRecord = { [K in PlacedKind]: Card<K> }[PlacedKind]

/** Whether a card is a text card. */
export const isTextCard = (card: CardRecord): card is TextCard =>
  card.kind === "text"

/** A canvas's card's content: nothing. */
export const NO_CONTENT: Readonly<Record<string, never>> = {}

/** A thread's, a note column's or a media column's card as it is made, a copy's too: its box not ticked. */
export const UNTICKED: ColumnContent = { ticked: false }

/**
 * Where a card's words are read (`KINDS`' `text`): its text document, the
 * fact it holds, or nowhere. Every reader of what cards say (the drain, the
 * context builders, search) gathers through it, so none branches on kind.
 */
export type TextSource =
  | { readonly kind: "doc"; readonly card: TextCardId }
  | { readonly kind: "fact"; readonly fact: QueuedFact }
  | { readonly kind: "blob"; readonly sha: Sha256 }
  | { readonly kind: "ask"; readonly relay: RelayDetails }
  | { readonly kind: "none" }

export function cardTextSource(card: CardRecord): TextSource {
  switch (card.kind) {
    case "text":
      return { kind: "doc", card: card.id }
    case "fact":
      return { kind: "fact", fact: card.content.fact }
    case "reference":
      return { kind: "blob", sha: card.content.quote }
    case "ask":
      return { kind: "ask", relay: card.content.relay }
    case "thread":
    case "canvas":
    case "note-column":
    case "media":
    case "image":
      return { kind: "none" }
  }
}

/**
 * The blobs a card holds, which the sweep keeps while the card is: a
 * reference's quote, an image's versions. A text card's text names blobs of
 * its own, which the sweep reads from the text.
 */
export function cardBlobs(card: CardRecord): readonly Sha256[] {
  switch (card.kind) {
    case "reference":
      return [card.content.quote]
    case "image":
      return card.content.versions.flatMap(v =>
        v.original === v.sha256 ? [v.sha256] : [v.sha256, v.original],
      )
    case "text":
    case "thread":
    case "canvas":
    case "note-column":
    case "fact":
    case "ask":
    case "media":
      return []
  }
}

/**
 * A new card of `kind`, made by `by`, its owner and placer: the one way a
 * record is built, a person's or the host's, so a place its kind is never in
 * does not compile. `planMake` (`@pinetrie/rules`) decides whether the host
 * writes it.
 */
export const makeCard = <K extends PlacedKind>(
  kind: K,
  id: IdOf<K>,
  place: PlaceOf<K>,
  content: ContentOf[K],
  by: WriterId,
): Card<K> => ({ kind, id, owner: by, placer: by, place, content })
