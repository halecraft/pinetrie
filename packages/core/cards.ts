// cards — what a card is: an identity, one place and content; each kind's
// content, the one maker of a record (`makeCard`), where a card's words are
// read (`textSourceOf`), a text card's commands, and a card's history and
// traces. Where cards are, and how they move, is `places.ts`'.

import type { Address } from "./address.ts"
import type { CardId, EntryId, TextCardId, ThreadId, WriterId } from "./ids.ts"
import type { Sha256 } from "./images.ts"
import type {
  BranchedFact,
  BudgetSpentFact,
  CatchUpFrom,
  MemberFact,
  RelayDetails,
  RoundFact,
  StopFact,
  UnansweredFact,
  UndeliveredFact,
} from "./index.ts"
import type { IdOf, PlaceKey, PlaceOf } from "./places.ts"

/**
 * The commands that catch a thread up. The first two bring the thread up to
 * date with its base, `continue-on-accepted` moving a thread whose WIP is gone
 * to accepted work first; `catch-up-with-parent` merges the thread it branched
 * from.
 */
export type CatchUpCommand =
  | "bring-up-to-date"
  | "continue-on-accepted"
  | "catch-up-with-parent"
export const CATCH_UP_COMMANDS: readonly CatchUpCommand[] = [
  "bring-up-to-date",
  "continue-on-accepted",
  "catch-up-with-parent",
]

/**
 * A command a card is sent through; a plain card has none. The catch-up
 * commands, and `split`, which splits the thread's proposed changes into a
 * stack in a run of its own, its text the person's intent.
 */
export type CardCommand = CatchUpCommand | "split"
export const CARD_COMMANDS: readonly CardCommand[] = [
  ...CATCH_UP_COMMANDS,
  "split",
]

/** Whether `command` catches the thread up, rather than doing something else. */
export const isCatchUp = (command: CardCommand): command is CatchUpCommand =>
  (CATCH_UP_COMMANDS as readonly string[]).includes(command)

/**
 * What a command on a thread's proposed changes did, as a fact in the thread:
 * an acceptance, with the change it was added as, the bookmark it moved and
 * what that bookmark is to the thread; or a description asked for again, a
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
      readonly to: CatchUpFrom
    }
  | {
      readonly kind: "described" | "squashed" | "refreshed"
      readonly lane: ThreadId
      readonly by: WriterId
    }

/**
 * A fact on its way into its thread: what a fact card holds, appended as an
 * entry when the thread's end consumes it. What a command on the proposed
 * changes did, who stopped a run, a member dismissed or gone, a budget spent,
 * an ask unanswered or an answer undelivered, a round's line for people, or a
 * proposal's branches opened.
 */
export type QueuedFact =
  | ProposedChangesFact
  | StopFact
  | MemberFact
  | BudgetSpentFact
  | UnansweredFact
  | UndeliveredFact
  | RoundFact
  | BranchedFact

/** A card's command, or null: only a text card has one. */
export const commandOf = (card: CardRecord): CardCommand | null =>
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
 * - A note column: nothing here; its title is the host's record (`NOTE_COLUMN`,
 *   absent while untitled), and its notes are text cards whose place names it.
 * - A fact: the fact, appended to its thread as the thread's end consumes it.
 * - A reference: an address, and the quote of what it names, kept as a blob:
 *   the past never changes, so the quote is exact, and the reference draws
 *   without loading its referent's root.
 */
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
  readonly thread: Readonly<Record<string, never>>
  readonly canvas: Readonly<Record<string, never>>
  readonly "note-column": Readonly<Record<string, never>>
  readonly fact: { readonly fact: QueuedFact }
  readonly ask: { readonly relay: RelayDetails }
}

/** The kinds of card with records: the reserved `media` and `file` have none yet. */
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

/**
 * A card's record, by kind, so a text card on a canvas, a thread's card in a
 * queue or a fact anywhere but a queue does not compile.
 */
export type CardRecord = { [K in PlacedKind]: Card<K> }[PlacedKind]

/** Whether a card is a text card. */
export const isTextCard = (card: CardRecord): card is TextCard =>
  card.kind === "text"

/** A thread card's content, and a note column's: nothing. */
export const NO_CONTENT: Readonly<Record<string, never>> = {}

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

export function textSourceOf(card: CardRecord): TextSource {
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
      return { kind: "none" }
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

/**
 * One change to a living card's place: who made it, from where to where, and
 * when. What the change was called (queued, took into the inventory, pinned) is
 * read from the two places when it is worded (`verbOf`).
 */
export interface CardEvent {
  readonly kind: "created" | "moved" | "undone" | "redone" | "unsent"
  /** Who made it; null for the host's own write. */
  readonly by: WriterId | null
  readonly from: PlaceKey | null
  readonly to: PlaceKey
  readonly at: number
}

/**
 * A card's history: a host-written `pinetrie.card-history` value in the
 * session, keyed by the card, and deleted with it.
 */
export interface CardHistoryRecord {
  readonly card: CardId
  /** Oldest first; at most `HISTORY_EVENTS`, the first always kept. */
  readonly events: readonly CardEvent[]
}

/**
 * The places a trace is left at: a thread's queue and its pinned cards, at the
 * thread's end, where its column draws it. A note moved by someone else leaves
 * none: a note column is everyone's scratch. Each has its drawer in
 * `@pinetrie/rules`' `TRACED`.
 */
export type TracedKind = "queued" | "pinned"

/** Where a trace was left: a key of a place in `TracedKind`. */
export type TracedPlace = Extract<PlaceKey, { readonly kind: TracedKind }>

/**
 * What stays where your card was when someone else moved it, while you were not
 * looking: a host-written `pinetrie.trace` value in the session, keyed by its
 * own id, since it outlives its card. Drawn only for its placer, and deleted
 * once they have seen it.
 */
export interface TraceRecord {
  readonly id: string
  /** The card's placer before it moved: the one person it is drawn for. */
  readonly for: WriterId
  readonly card: CardId
  readonly by: WriterId
  readonly from: TracedPlace
  /** Where the card went; null when it was sent. */
  readonly to: PlaceKey | null
  /** The message a send wrote; null for any other move. */
  readonly message: EntryId | null
  readonly at: number
}
