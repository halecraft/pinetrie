// places — where cards are: its places and their keys, which kinds each takes
// (`PLACES_OF`), the targets and moves between them, reorders, and the places
// row's fields. What a card is, is `cards.ts`'.

import type {
  Card,
  CardRecord,
  NoteColumnCard,
  PlacedKind,
  ReferenceCard,
  TextCard,
  ThreadCard,
} from "./cards.ts"
import {
  type AskCardId,
  type CanvasId,
  type CardId,
  type CardKind,
  type EntryId,
  entryId,
  type FactCardId,
  type FileCardId,
  isCanvasId,
  isNoteColumnId,
  isThreadId,
  isWorkflowStateId,
  kindOfCard,
  type MediaId,
  type NoteColumnId,
  parseCardId,
  type ReferenceCardId,
  type TextCardId,
  type ThreadId,
  type WorkflowStateId,
  type WriterId,
} from "./index.ts"
import { KINDS } from "./kinds.ts"

/**
 * Where a card is, any place but a trash. Composing: your message, in your
 * composer at a thread's end, which only you see; kept as its thread, and
 * resolved to the thread's end (`placeEnd`) whenever it is needed, so it
 * follows its thread as the thread grows. Note: in a note column, at its
 * rank there, shared by everyone in the canvas. Pinned: at the top of a
 * thread's column, kept and resolved the same way; the agent reads it on
 * every run. Queued: above the line, waiting for its thread's lane, until
 * the host pops it or someone unqueues it. Margin: beside an entry, a
 * comment on it, shared by everyone in the canvas and never read by the
 * agent; it names the entry's thread too, so its canvas is found without
 * reading a tree. Canvas: a thread card or a note column in a canvas, at its
 * rank there: the only record of where it is, so a card has one place by
 * construction; a thread not yet started is a thread card there too.
 * Inventory: in its holder's inventory; which slot holds it is the
 * holder's own document (`InventoryDoc`), not the host's. Board: a canvas's
 * card, in a workflow state of the team's board, at its rank there.
 */
export type LivePlace =
  | {
      readonly kind: "composing"
      /**
       * Its thread, whose end it is at: every entry names its thread, so the
       * end is found from it alone.
       */
      readonly thread: ThreadId
    }
  | {
      readonly kind: "note"
      /** The note column it is in. */
      readonly column: NoteColumnId
      /** Its rank in the column: an order key, the host's to give. */
      readonly order: string
    }
  | {
      readonly kind: "pinned"
      readonly thread: ThreadId
      /** Sorts the thread's pinned cards, in the order they were pinned. */
      readonly order: string
    }
  | {
      readonly kind: "canvas-pinned"
      /** The canvas it is pinned to: every thread of it reads it. */
      readonly canvas: CanvasId
      /** Sorts the canvas's pinned cards, in the order they were pinned. */
      readonly order: string
    }
  | {
      readonly kind: "queued"
      /** Its thread, whose lane pops it. */
      readonly thread: ThreadId
      /** Sorts the lane's queue; ties go by id. */
      readonly order: string
      /** Who queued it: its message's author. */
      readonly by: WriterId
      /**
       * The text's version as its queuer had it (`textVersion`), "" for none:
       * the host pops the card only once it holds that much.
       */
      readonly seen: string
    }
  | {
      readonly kind: "margin"
      /** The entry it comments on. */
      readonly entry: EntryId
      /** The entry's thread: its canvas's, read without a tree. */
      readonly thread: ThreadId
      /** Its rank among the entry's comments: an order key, the host's to give. */
      readonly order: string
    }
  | {
      readonly kind: "canvas"
      readonly canvas: CanvasId
      /** Its rank on the canvas: an order key, the host's to give. */
      readonly order: string
      readonly width: CardWidth
    }
  | { readonly kind: "inventory"; readonly holder: WriterId }
  | {
      readonly kind: "board"
      /** Its workflow state. */
      readonly state: WorkflowStateId
      /** Its rank in the state: an order key, the host's to give. */
      readonly order: string
    }

/**
 * Where a card is. A trashed card is drawn nowhere and records the place
 * it left, and nothing else: whose trash it is, who may restore it, where
 * a restore puts it and which history it is in all follow from `left`
 * (`surfaceOwner`). Who trashed it is the card's placer, as for any move. It is
 * kept so a restore or the undo key can bring it back, until the host
 * sweeps it.
 */
export type CardPlace =
  | LivePlace
  | { readonly kind: "trash"; readonly left: LivePlace }

/** The live place a card's surface is on: its place, or for a trashed card the place it left. */
export const livePlace = (place: CardPlace): LivePlace =>
  place.kind === "trash" ? place.left : place

/**
 * Who a surface belongs to: a canvas (its canvas, its pinned cards), a note
 * column (its notes), a thread (its dock and its entries' margins), a
 * person (their inventory) or the team (its board).
 */
export type SurfaceOwner =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "note-column"; readonly column: NoteColumnId }
  | { readonly kind: "thread"; readonly thread: ThreadId }
  | { readonly kind: "person"; readonly holder: WriterId }
  | { readonly kind: "team" }

/**
 * Who the surface `place` (or a key of it) is on belongs to. A trashed
 * card's trash is its `left`'s owner's.
 */
export function surfaceOwner(
  place: LivePlace | Exclude<PlaceKey, { readonly kind: "trash" }>,
): SurfaceOwner {
  switch (place.kind) {
    case "canvas":
    case "canvas-pinned":
      return { kind: "canvas", canvas: place.canvas }
    case "note":
      return { kind: "note-column", column: place.column }
    case "composing":
    case "pinned":
    case "queued":
    case "margin":
      return { kind: "thread", thread: place.thread }
    case "inventory":
      return { kind: "person", holder: place.holder }
    case "board":
      return { kind: "team" }
  }
}

/** The card a surface owner is, if it is one: a canvas's, a note column's or a thread's id. */
export const ownerCard = (owner: SurfaceOwner): CardId | null =>
  owner.kind === "canvas"
    ? owner.canvas
    : owner.kind === "note-column"
      ? owner.column
      : owner.kind === "thread"
        ? owner.thread
        : null

/** How many columns a card on a canvas is drawn across. */
export type CardWidth = 1 | 2

/**
 * The card a chat is sent from, with its text's version as its sender had it
 * (`textVersion`): queued, the host pops it only once it holds that much of the
 * text.
 */
export interface SentCard {
  readonly id: TextCardId
  readonly seen: string
}

type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Where a card is, without what the host assigns when it queues, pins or places
 * one (its order, who queued it, a canvas card's width). A move compares it and
 * targets it. A queued key keeps its text's version (`seen`), which the queuer
 * sends with the move.
 */
export type PlaceKey =
  | OmitEach<
      Exclude<CardPlace, { readonly kind: "trash" }>,
      "order" | "by" | "width"
    >
  /**
   * A discard names no place left: the host fills it in from where the
   * card is, and names its history from it (`movesHistory`).
   */
  | { readonly kind: "trash" }

/** A place key that is a list a new card is written at the end of. */
export type ListKey = Extract<
  PlaceKey,
  { readonly kind: "note" | "pinned" | "margin" }
>

/**
 * A move's target alone, never where a card is: the note column nearest
 * `thread`'s card in its canvas, or nearest `canvas`'s own column, which stands
 * before every card (`nearestNoteColumn`). The host resolves it before it plans
 * the move, making a column when the canvas has none.
 */
export type NotesTarget =
  | {
      readonly kind: "notes"
      readonly near: "thread"
      readonly thread: ThreadId
    }
  | {
      readonly kind: "notes"
      readonly near: "canvas"
      readonly canvas: CanvasId
    }

/**
 * A drop on a canvas: a move's target alone, never where a card is: `canvas`'s
 * canvas just after the card `after`, null for before every card. The host
 * ranks it there before it plans the move (`planMoveTargets`); an `after` no
 * longer on that canvas lands it at the end, a hint and not a compare-and-set.
 * Its own kind, so a target not yet ranked is never taken for a canvas's key.
 */
export interface CanvasTarget {
  readonly kind: "canvas-at"
  readonly canvas: CanvasId
  readonly after: CardId | null
}

/** Where a move sends a card: a place's key, a thread's nearest notes, or a spot on a canvas. */
export type MoveTarget =
  | PlaceKey
  | NotesTarget
  | CanvasTarget
  | BackTarget
  | NewCanvasTarget

/**
 * Back to where a trashed card was: a restore. The host resolves it to the
 * card's `left`, at the rank it had there, and refuses it when that place
 * can no longer take the card.
 */
export interface BackTarget {
  readonly kind: "back"
}

/** The one restore target. */
export const BACK: BackTarget = { kind: "back" }

/**
 * A new canvas, made by the mover at the end of the board's first state,
 * with the card first on its canvas: a column dropped between two canvases in
 * the sidebar. `canvas` is the new canvas's id, minted by the page.
 */
export interface NewCanvasTarget {
  readonly kind: "new-canvas"
  readonly canvas: CanvasId
}

/** A canvas's key with the rank a drop was given there (`CanvasTarget`, resolved). */
export interface RankedCanvas {
  readonly kind: "canvas"
  readonly canvas: CanvasId
  readonly order: string
}

/** A place's key: the same kind of place, with what the host assigns left out. */
export function placeKey<P extends CardPlace>(
  place: P,
): Extract<PlaceKey, { readonly kind: P["kind"] }>
export function placeKey(place: CardPlace): PlaceKey {
  switch (place.kind) {
    case "composing":
      return place
    case "note":
      return { kind: "note", column: place.column }
    case "pinned":
      return { kind: "pinned", thread: place.thread }
    case "canvas-pinned":
      return { kind: "canvas-pinned", canvas: place.canvas }
    case "queued":
      return { kind: "queued", thread: place.thread, seen: place.seen }
    case "margin":
      return { kind: "margin", entry: place.entry, thread: place.thread }
    case "canvas":
      return { kind: "canvas", canvas: place.canvas }
    case "inventory":
      return place
    case "board":
      return { kind: "board", state: place.state }
    case "trash":
      return { kind: "trash" }
  }
}

/**
 * Whether two keys name one place. A queue's, the pinned cards' or a
 * canvas's order is not part of a key, so a reorder does not make someone
 * else's move fail.
 */
export function sameKey(a: PlaceKey, b: PlaceKey): boolean {
  switch (a.kind) {
    case "composing":
      return b.kind === "composing" && a.thread === b.thread
    // A note's rank is not part of where it is, as a queued card's is not.
    case "note":
      return b.kind === "note" && a.column === b.column
    case "pinned":
      return b.kind === "pinned" && a.thread === b.thread
    case "canvas-pinned":
      return b.kind === "canvas-pinned" && a.canvas === b.canvas
    case "queued":
      return b.kind === "queued" && a.thread === b.thread
    // An entry names its thread, so the entry alone says which margin.
    case "margin":
      return b.kind === "margin" && a.entry === b.entry
    case "canvas":
      return b.kind === "canvas" && a.canvas === b.canvas
    case "inventory":
      return b.kind === "inventory" && a.holder === b.holder
    case "board":
      return b.kind === "board" && a.state === b.state
    case "trash":
      return b.kind === "trash"
  }
}

/**
 * Whether a card at `now` is where a move's sender saw it, `from`. A card
 * on its way to a thread's nearest notes is drawn where the host would put
 * it, or where it was (`drawnPlace`), so its sender never sees it at a
 * target.
 */
export const isWhereSenderSaw = (now: PlaceKey, from: PlaceKey): boolean =>
  sameKey(now, from)

/**
 * What queueing a card does to its queue's hold: nothing; hold an idle queue
 * first, so a card staged there is not sent while it is written; or release it,
 * so the card is sent after those queued before it.
 */
export type QueueHoldChange = "keep" | "hold-if-idle" | "release"
export const QUEUE_HOLD_CHANGES: readonly QueueHoldChange[] = [
  "keep",
  "hold-if-idle",
  "release",
]

/** Which way an undo of moves goes. */
export type MoveDirection = "undo" | "redo"
export const MOVE_DIRECTIONS: readonly MoveDirection[] = ["undo", "redo"]

/**
 * A handoff: move a card from where its sender saw it to another place. `from`
 * null creates the card. Nobody removes one: a discard is a move to the trash,
 * and only the host deletes a record, for a card it sends or sweeps.
 */
export interface Move<To extends MoveTarget = MoveTarget> {
  readonly card: CardId
  readonly from: PlaceKey | null
  readonly to: To
}

/**
 * Where a move the host plans sends a card: a place's key, but a canvas's
 * with the rank it was given there (`RankedCanvas`), so no card lands on a
 * canvas unranked. No person's move takes a canvas's card (`KINDS`), so a
 * board's key is never one.
 */
export type ResolvedTarget =
  | Exclude<PlaceKey, { readonly kind: "canvas" | "board" }>
  | RankedCanvas

/**
 * A move to a place: every move the host plans, once a thread's nearest
 * notes and a spot on a canvas are resolved (`planMoveTargets`), so
 * `planMove` cannot be given an unresolved one, nor a canvas with no rank.
 */
export type ResolvedMove = Move<ResolvedTarget>

/** A canvas's key: where a card on a canvas is, its rank and width left out. */
export type CanvasKey = Extract<PlaceKey, { readonly kind: "canvas" }>

/** A queue's key: where a card is queued, its text's version as its queuer had it. */
export type QueuedKey = Extract<PlaceKey, { readonly kind: "queued" }>

/** A move into a queue: a `queue-card`'s, which changes the queue's hold with it. */
export type QueueMove = Move<QueuedKey>

/**
 * The places a reorder moves a card among: a queue, a thread's pinned cards, a
 * canvas's pinned cards, a note column, an entry's margin, or a canvas.
 * Each has its rule in `@pinetrie/rules`' `REORDERS`. A canvas's card is
 * reordered on the board by the board's own move (`planBoardMove`), which may
 * cross the archive's edge.
 */
export const REORDER_PLACES = [
  "queued",
  "pinned",
  "canvas-pinned",
  "note",
  "margin",
  "canvas",
] as const

/** Where a reorder is: a key of a place in `REORDER_PLACES`. */
export type ReorderAt = Extract<
  PlaceKey,
  { readonly kind: (typeof REORDER_PLACES)[number] }
>

/** Whether a card at `key` is reordered among its neighbours there. */
export const isReorderPlace = (key: PlaceKey): key is ReorderAt => {
  const kinds: readonly PlaceKey["kind"][] = REORDER_PLACES
  return kinds.includes(key.kind)
}

/** A place with a rank among its neighbours: every one with an `order`. */
export type OrderedPlace = Extract<CardPlace, { readonly order: string }>

/**
 * A card's new place among its neighbours, as its sender saw them: what a card
 * does in its place, not a move between places. It stays in the same queue,
 * among the same pinned cards, in the same note column, or on the same canvas.
 */
export interface Reorder {
  readonly card: CardId
  readonly at: ReorderAt
  /** The card it goes after, null for the first. */
  readonly after: CardId | null
  /** The card it goes before, null for the last. */
  readonly before: CardId | null
}

/**
 * `card`'s move from where it is now to `to`, typed by its kind
 * (`MoveOf`): `to` must be a target its kind is ever sent to, so a thread's
 * card is never moved into a queue, nor a text card onto a canvas but at a
 * spot there, where a note column is made for it (`WRAPS`). A card whose
 * kind is not known goes only where every kind may: an inventory.
 */
export function cardMove<To extends TargetOf<"text">>(
  card: TextCard,
  to: To,
): MoveOf<"text"> & { readonly to: To }
export function cardMove<To extends TargetOf<"thread">>(
  card: ThreadCard,
  to: To,
): MoveOf<"thread"> & { readonly to: To }
export function cardMove<To extends TargetOf<"reference">>(
  card: ReferenceCard,
  to: To,
): MoveOf<"reference"> & { readonly to: To }
export function cardMove<To extends TargetOf<"note-column">>(
  card: NoteColumnCard,
  to: To,
): MoveOf<"note-column"> & { readonly to: To }
export function cardMove(
  card: TextCard | ThreadCard | ReferenceCard,
  to: Extract<PlaceKey, { readonly kind: "inventory" }>,
): TypedMove
export function cardMove(
  card: ThreadCard | NoteColumnCard | TextCard | ReferenceCard,
  to: CanvasTarget,
): TypedMove
export function cardMove(
  card: ThreadCard | NoteColumnCard,
  to: NewCanvasTarget,
): TypedMove
export function cardMove(
  card: TextCard | ReferenceCard,
  to: NotesTarget,
): TypedMove
export function cardMove(
  card: TextCard | ReferenceCard | ThreadCard | NoteColumnCard,
  to: Extract<PlaceKey, { readonly kind: "trash" }> | BackTarget,
): TypedMove
export function cardMove(card: CardRecord, to: MoveTarget): Move {
  return { card: card.id, from: placeKey(card.place), to }
}

/**
 * Where an unqueue or an unpin puts a card, and where your message goes to the
 * notes: the note column nearest its thread, which the host resolves (`notes`).
 * The one way a card at a thread becomes a note.
 */
export const notesTarget = (
  place: Extract<CardPlace, { kind: "queued" | "pinned" | "composing" }>,
): NotesTarget => ({ kind: "notes", near: "thread", thread: place.thread })

/** The thread a place is at: your message's, a pinned or queued card's; null for any other. */
export const threadOfPlace = (place: CardPlace | PlaceKey): ThreadId | null =>
  place.kind === "composing" ||
  place.kind === "pinned" ||
  place.kind === "queued"
    ? place.thread
    : null

/**
 * Where a discard puts a card: a trash, the host filling in the place it
 * left, from which its history is named (`movesHistory`).
 */
export const DISCARDED: Extract<PlaceKey, { readonly kind: "trash" }> = {
  kind: "trash",
}

/**
 * Where a pin puts your message or a queued card: pinned at the same thread
 * end. Null for any other place: a note has no thread to pin it to.
 */
export const pinTargetKey = (
  place: CardPlace | PlaceKey,
): Extract<PlaceKey, { readonly kind: "pinned" }> | null =>
  place.kind === "composing" || place.kind === "queued"
    ? { kind: "pinned", thread: place.thread }
    : null

/** Why the host refused a move. */
export type MoveRefusal =
  /** The card is no longer where the sender saw it. */
  | "moved"
  /** The card has no record: sent, or discarded. */
  | "gone"
  /** A creation whose id is in use. */
  | "exists"
  /** The sender's inventory holds `INVENTORY_SLOTS` cards already. */
  | "full"
  /** A move into or out of someone else's inventory. */
  | "not-yours"
  /**
   * An undo that would lift back a thread a card was spun into, after someone
   * wrote there, or the agent started on it.
   */
  | "replied"
  /**
   * An undo or a redo that would move a canvas's card across the archive's edge:
   * archiving and restoring are done on the board, which gathers what crossing
   * it needs.
   */
  | "archived"
  /**
   * A card moved to a place its kind is never in (`KINDS`): a text card on
   * a canvas, a thread's card into a queue, a fact out of its queue.
   */
  | "no-place"
  /**
   * A restore whose place is gone: what that place is on (a note column, a
   * thread, a canvas) is itself trashed, or has no record.
   */
  | "left-gone"
  /** A restore of your message where you have written a newer one. */
  | "left-taken"

/** Any refusal of a change of place, as the wire carries it: a move's or a reorder's. */
export type PlaceRefusal = MoveRefusal | ReorderRefusal

/** Why the host refused a reorder: never a move's answer. */
export type ReorderRefusal =
  /** The card has no record. */
  | "gone"
  /** The card is no longer where the sender saw it. */
  | "moved"
  /**
   * Its neighbours are not where its sender saw them: one gone, in another
   * place, or the two out of order.
   */
  | "order-changed"
  /**
   * A fact, which no reorder moves, or a card that would pass one: a fact says
   * what already happened, so nothing queued jumps ahead of it.
   */
  | "fact"

/**
 * A place as flat strings, "" for none: how the places document stores it,
 * and how the wire carries a key. `placeFields` writes this shape, and
 * `placeOfFields` and `keyOfFields` read it.
 */
export interface PlaceFields {
  readonly kind: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly holder: string
  /** A canvas card's canvas, or one a card is pinned to. */
  readonly canvas: string
  /** A canvas card's width, `1` or `2`. */
  readonly width: string
  /** A canvas card's workflow state. */
  readonly state: string
}

/**
 * Whether a field travels in a key: always, never (it is the host's to
 * give), or for some kinds of place alone.
 */
type FieldCodec =
  | { readonly key: "always" }
  | { readonly key: "never" }
  | { readonly key: "for"; readonly kinds: readonly string[] }

/**
 * Every field of a place, once: the store's row, the wire's key and the
 * history's events are built from it, so a field one of them forgot would
 * be a compile error here, not a move refused `moved`.
 */
const PLACE_FIELDS = {
  kind: { key: "always" },
  at: { key: "always" },
  lane: { key: "always" },
  column: { key: "always" },
  order: { key: "never" },
  by: { key: "never" },
  seen: { key: "always" },
  holder: { key: "always" },
  // A trash key names no canvas: the host names a discard's history.
  canvas: {
    key: "for",
    kinds: ["canvas", "canvas-at", "canvas-pinned", "notes", "new-canvas"],
  },
  width: { key: "never" },
  state: { key: "always" },
} as const satisfies Record<keyof PlaceFields, FieldCodec>

const FIELD_NAMES = Object.keys(PLACE_FIELDS) as readonly (keyof PlaceFields)[]

/** Every field "": a place's row before its kind fills it in. */
const NO_FIELDS: PlaceFields = Object.fromEntries(
  FIELD_NAMES.map(f => [f, ""]),
) as unknown as PlaceFields

/** Stored fields, any one absent read as "": a row written before the field was. */
export const asPlaceFields = (
  stored: Partial<Record<keyof PlaceFields, string>>,
): PlaceFields => ({ ...NO_FIELDS, ...stored })

const inKey = (field: keyof PlaceFields, kind: string): boolean => {
  const codec: FieldCodec = PLACE_FIELDS[field]
  return (
    codec.key === "always" ||
    (codec.key === "for" && codec.kinds.includes(kind))
  )
}

/** A key's fields as the wire carries them: those `PLACE_FIELDS` puts in a key. */
export const wireKeyFields = (fields: PlaceFields): Partial<PlaceFields> =>
  Object.fromEntries(
    FIELD_NAMES.filter(f => inKey(f, fields.kind)).map(f => [f, fields[f]]),
  )

/**
 * A key's fields from the wire, each read by `read` ("" for none), those
 * no key carries left "". Read by `keyOfFields`.
 */
export const keyFieldsFrom = (
  read: (field: keyof PlaceFields) => string,
): PlaceFields => {
  const kind = read("kind")
  return Object.fromEntries(
    FIELD_NAMES.map(f => [f, inKey(f, kind) ? read(f) : ""]),
  ) as unknown as PlaceFields
}

/**
 * The fields each stored kind of row carries besides `kind`; every other
 * field of its row is "". A field means what its kind's row says:
 *
 * - your message is stored as `drafting`, a thread's id in `lane` (a lane is
 *   named by its thread), its root the thread's;
 * - a thread's nearest notes, its id in `lane`; a canvas's, its id in `canvas`;
 * - a spot on a canvas, the card it goes after in `column` ("" for first);
 * - a comment, its entry in `at` and the entry's thread in `lane`;
 * - a trash's key as `discarded`, every field "" (a card in a trash is
 *   stored as the place it left, its kind `discarded-` and that place's
 *   stored kind: `trashedFields`);
 * - a canvas's card on the board, its workflow state in `state`.
 */
const ROWS = {
  drafting: ["lane"],
  note: ["column", "order"],
  notes: ["lane", "canvas"],
  "canvas-pinned": ["canvas", "order"],
  "canvas-at": ["canvas", "column"],
  back: [],
  "new-canvas": ["canvas"],
  pinned: ["lane", "order"],
  queued: ["lane", "order", "by", "seen"],
  margin: ["at", "lane", "order"],
  canvas: ["canvas", "order", "width"],
  inventory: ["holder"],
  discarded: [],
  board: ["state", "order"],
} as const satisfies Record<
  string,
  readonly Exclude<keyof PlaceFields, "kind">[]
>

type RowKind = keyof typeof ROWS

/** The fields a row of `K` carries, and no other. */
type RowOf<K extends RowKind> = {
  readonly [F in (typeof ROWS)[K][number]]: string
}

/** A stored row read by its kind: each kind's case reads its own fields alone. */
type Row = { [K in RowKind]: { readonly kind: K } & RowOf<K> }[RowKind]

/** A row of `kind`, its fields `fields`, every other "". */
const row = <K extends RowKind>(kind: K, fields: RowOf<K>): PlaceFields => ({
  ...NO_FIELDS,
  ...fields,
  kind,
})

/** `f` read by its kind (`ROWS`); undefined for a kind no row has. */
const rowOf = (f: PlaceFields): Row | undefined =>
  f.kind in ROWS ? (f as Row) : undefined

/** The fields each stored kind carries (`ROWS`), for tests. */
export const storedRowFields = (
  kind: string,
): readonly string[] | undefined => {
  const of = kind.startsWith(TRASHED) ? kind.slice(TRASHED.length) : kind
  return of in ROWS ? ROWS[of as RowKind] : undefined
}

/**
 * A place (or a key, whose `order`, `by` and `width` are "", or a move's
 * target) as flat strings, each kind's row as `ROWS` has it.
 */
export function placeFields(place: CardPlace | MoveTarget): PlaceFields {
  switch (place.kind) {
    // Your message keeps the stored kind it had as a drafting card, so no
    // stored row changed with the split.
    case "composing":
      return row("drafting", { lane: place.thread })
    case "note":
      return row("note", {
        column: place.column,
        order: "order" in place ? place.order : "",
      })
    case "notes":
      return place.near === "thread"
        ? row("notes", { lane: place.thread, canvas: "" })
        : row("notes", { lane: "", canvas: place.canvas })
    case "canvas-pinned":
      return row("canvas-pinned", {
        canvas: place.canvas,
        order: "order" in place ? place.order : "",
      })
    case "canvas-at":
      return row("canvas-at", {
        canvas: place.canvas,
        column: place.after ?? "",
      })
    case "back":
      return row("back", {})
    case "new-canvas":
      return row("new-canvas", { canvas: place.canvas })
    case "pinned":
      return row("pinned", {
        lane: place.thread,
        order: "order" in place ? place.order : "",
      })
    case "queued":
      return row("queued", {
        lane: place.thread,
        order: "order" in place ? place.order : "",
        by: "by" in place ? place.by : "",
        seen: place.seen,
      })
    case "margin":
      return row("margin", {
        at: place.entry,
        lane: place.thread,
        order: "order" in place ? place.order : "",
      })
    case "canvas":
      return row("canvas", {
        canvas: place.canvas,
        order: "order" in place ? place.order : "",
        width: "width" in place ? String(place.width) : "",
      })
    case "inventory":
      return row("inventory", { holder: place.holder })
    case "board":
      return row("board", {
        state: place.state,
        order: "order" in place ? place.order : "",
      })
    case "trash":
      return "left" in place ? trashedFields(place.left) : row("discarded", {})
  }
}

/** What a trashed card's row kind starts with, before its left place's stored kind. */
const TRASHED = "discarded-"

/** A trashed card's row: the place it left, its kind prefixed `discarded-`. */
const trashedFields = (left: LivePlace): PlaceFields => {
  const fields = placeFields(left)
  return { ...fields, kind: `${TRASHED}${fields.kind}` }
}

/** A stored width -> a card's width; undefined for any other. */
const widthOf = (width: string): CardWidth | undefined =>
  width === "1" ? 1 : width === "2" ? 2 : undefined

/** A place at a thread: its `thread`, from the row's `lane`; undefined for none. */
const atThread = (r: {
  readonly lane: string
}): { readonly thread: ThreadId } | undefined =>
  isThreadId(r.lane) ? { thread: r.lane } : undefined

/**
 * Flat strings -> a place; undefined for one that is malformed. A card at a
 * thread's end, pinned or queued names its thread alone. A canvas card
 * needs its `CanvasId`. An inventory's holder is never "". A trashed card's
 * row is the place it left, read the same way. A pinned card needs its order, and a
 * canvas card its order and width. A queued card needs its order and who
 * queued it. A note needs its column and its order. A target's row is no
 * place.
 */
export function placeOfFields(f: PlaceFields): CardPlace | undefined {
  if (f.kind.startsWith(TRASHED)) {
    const left = livePlaceOfFields({ ...f, kind: f.kind.slice(TRASHED.length) })
    return left === undefined ? undefined : { kind: "trash", left }
  }
  return livePlaceOfFields(f)
}

/** Flat strings -> a place but a trash; undefined for one that is malformed. */
function livePlaceOfFields(f: PlaceFields): LivePlace | undefined {
  const r = rowOf(f)
  switch (r?.kind) {
    case undefined:
    case "notes":
    case "canvas-at":
    case "back":
    case "new-canvas":
      return undefined
    case "canvas": {
      const width = widthOf(r.width)
      return !isCanvasId(r.canvas) || r.order === "" || width === undefined
        ? undefined
        : { kind: "canvas", canvas: r.canvas, order: r.order, width }
    }
    case "note":
      return !isNoteColumnId(r.column) || r.order === ""
        ? undefined
        : { kind: "note", column: r.column, order: r.order }
    case "canvas-pinned":
      return !isCanvasId(r.canvas) || r.order === ""
        ? undefined
        : { kind: "canvas-pinned", canvas: r.canvas, order: r.order }
    case "inventory":
      return r.holder === ""
        ? undefined
        : { kind: "inventory", holder: r.holder as WriterId }
    case "board":
      return !isWorkflowStateId(r.state) || r.order === ""
        ? undefined
        : { kind: "board", state: r.state, order: r.order }
    case "discarded":
      return undefined
    case "drafting": {
      const at = atThread(r)
      return at === undefined ? undefined : { kind: "composing", ...at }
    }
    case "pinned": {
      const at = atThread(r)
      return at === undefined || r.order === ""
        ? undefined
        : { kind: "pinned", ...at, order: r.order }
    }
    case "queued": {
      const at = atThread(r)
      return at === undefined || r.order === "" || r.by === ""
        ? undefined
        : {
            kind: "queued",
            ...at,
            order: r.order,
            by: r.by as WriterId,
            seen: r.seen,
          }
    }
    case "margin": {
      const at = atThread(r)
      return at === undefined || r.at === "" || r.order === ""
        ? undefined
        : { kind: "margin", entry: entryId(r.at), ...at, order: r.order }
    }
  }
}

/**
 * Flat strings -> a key, as a move names one; undefined for one that is
 * malformed. A queued key has no order and no queuer, and keeps its text's
 * version; a pinned key has no order, nor a canvas key its order and width,
 * nor a note's key its order; a trash key names no place left, which is the host's
 * to fill in. A move's target may be a thread's nearest notes (`targetOfFields`).
 */
export function keyOfFields(f: PlaceFields): PlaceKey | undefined {
  if (f.kind.startsWith(TRASHED)) return { kind: "trash" }
  const r = rowOf(f)
  switch (r?.kind) {
    case "pinned": {
      const at = atThread(r)
      return at === undefined ? undefined : { kind: "pinned", ...at }
    }
    case "canvas":
      return isCanvasId(r.canvas)
        ? { kind: "canvas", canvas: r.canvas }
        : undefined
    case "note":
      return isNoteColumnId(r.column)
        ? { kind: "note", column: r.column }
        : undefined
    case "canvas-pinned":
      return isCanvasId(r.canvas)
        ? { kind: "canvas-pinned", canvas: r.canvas }
        : undefined
    case "discarded":
      return { kind: "trash" }
    case "board":
      return isWorkflowStateId(r.state)
        ? { kind: "board", state: r.state }
        : undefined
    case "queued": {
      const at = atThread(r)
      return at === undefined
        ? undefined
        : { kind: "queued", ...at, seen: r.seen }
    }
    case "margin": {
      const at = atThread(r)
      return at === undefined || r.at === ""
        ? undefined
        : { kind: "margin", entry: entryId(r.at), ...at }
    }
    default:
      return placeOfFields(f)
  }
}

/**
 * Flat strings -> a move's target: a thread's nearest notes, a spot on a
 * canvas, else a key (`keyOfFields`); undefined for one that is malformed.
 */
export function targetOfFields(f: PlaceFields): MoveTarget | undefined {
  const r = rowOf(f)
  switch (r?.kind) {
    case "notes":
      return isThreadId(r.lane)
        ? { kind: "notes", near: "thread", thread: r.lane }
        : isCanvasId(r.canvas)
          ? { kind: "notes", near: "canvas", canvas: r.canvas }
          : undefined
    case "canvas-at": {
      if (!isCanvasId(r.canvas)) return undefined
      if (r.column === "")
        return { kind: "canvas-at", canvas: r.canvas, after: null }
      const after = parseCardId(r.column)
      return after === undefined
        ? undefined
        : { kind: "canvas-at", canvas: r.canvas, after }
    }
    case "back":
      return BACK
    case "new-canvas":
      return isCanvasId(r.canvas)
        ? { kind: "new-canvas", canvas: r.canvas }
        : undefined
    default:
      return keyOfFields(f)
  }
}

/**
 * The places each kind of card is ever in (`KINDS`). `fitsPlace`, `placed`
 * and each record's place type read it.
 */
export const PLACES_OF: {
  readonly [K in CardKind]: (typeof KINDS)[K]["places"]
} = {
  text: KINDS.text.places,
  thread: KINDS.thread.places,
  canvas: KINDS.canvas.places,
  "note-column": KINDS["note-column"].places,
  fact: KINDS.fact.places,
  reference: KINDS.reference.places,
  ask: KINDS.ask.places,
  media: KINDS.media.places,
  file: KINDS.file.places,
}

/** The places a card of `K` is ever in (`PLACES_OF`). */
export type PlaceOf<K extends CardKind> = Extract<
  CardPlace,
  { readonly kind: (typeof PLACES_OF)[K][number] }
>

/** The places a text card is ever in. */
export type TextPlace = PlaceOf<"text">

/** A canvas card's place: a canvas and a rank there. */
export type CanvasPlace = Extract<CardPlace, { readonly kind: "canvas" }>

/** The kinds of card ever at a place of `P` (`PLACES_OF`). */
export type KindsInPlace<P extends CardPlace["kind"]> = {
  [K in PlacedKind]: P extends (typeof PLACES_OF)[K][number] ? K : never
}[PlacedKind]

/** A card at a place of `P`: one of `KindsInPlace<P>`, with its place narrowed. */
export type CardInPlace<P extends CardPlace["kind"]> = {
  [K in KindsInPlace<P>]: Card<K> & {
    readonly place: Extract<CardPlace, { readonly kind: P }>
  }
}[KindsInPlace<P>]

/**
 * Whether `card` is at a place of `P`. A record's place fits its kind
 * (`placed`), so the place alone decides it, for every kind `KINDS` puts
 * there.
 */
export const hasPlaceKind = <P extends CardPlace["kind"]>(
  card: CardRecord,
  place: P,
): card is CardRecord & CardInPlace<P> => card.place.kind === place

/** Whether a card of `kind` is ever at a place of `place` (`PLACES_OF`). */
export const fitsPlace = (kind: CardKind, place: PlaceKey["kind"]): boolean => {
  const places: readonly PlaceKey["kind"][] = PLACES_OF[kind]
  return places.includes(place)
}

/** A card of a kind ever at a place of `P` (`PLACES_OF`), wherever it is now. */
export type CardFittingPlace<P extends CardPlace["kind"]> = Extract<
  CardRecord,
  { readonly kind: KindsInPlace<P> }
>

/** Whether `card`'s kind is ever at a place of `P` (`PLACES_OF`). */
export const cardFitsPlace = <P extends CardPlace["kind"]>(
  card: CardRecord,
  place: P,
): card is CardFittingPlace<P> => fitsPlace(card.kind, place)

/** The kinds a person's move takes anywhere (`KINDS`' `moves`). */
export type MovableKind = {
  [K in PlacedKind]: (typeof KINDS)[K]["moves"] extends true ? K : never
}[PlacedKind]

/**
 * Whether a person may move `card` (`KINDS`' `moves`): false for a kind the
 * host alone places.
 */
export const isMovable = (
  card: CardRecord,
): card is Extract<CardRecord, { readonly kind: MovableKind }> =>
  KINDS[card.kind].moves

/** Whether `place` is one a card of `kind` is ever in (`PLACES_OF`). */
const fits = <K extends CardKind>(
  kind: K,
  place: CardPlace,
): place is PlaceOf<K> => fitsPlace(kind, place.kind)

/** `place` as a place of a card of `kind`; undefined for one its kind is never in. */
export const placeOfKind = <K extends CardKind>(
  kind: K,
  place: CardPlace,
): PlaceOf<K> | undefined => (fits(kind, place) ? place : undefined)

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
  readonly file: FileCardId
}[K]

/** The keys of the places a card of `K` is ever in. */
export type KeyOf<K extends CardKind> = Extract<
  PlaceKey,
  { readonly kind: (typeof PLACES_OF)[K][number] }
>

/**
 * The place each target that is no place resolves to: a thread's nearest
 * notes to a note, a spot on a canvas to the canvas.
 */
const TARGET_PLACES = {
  notes: "note",
  "canvas-at": "canvas",
  // Only a card a trash takes is ever in one to come back from.
  back: "trash",
  "new-canvas": "canvas",
} as const satisfies Record<
  (NotesTarget | CanvasTarget | BackTarget | NewCanvasTarget)["kind"],
  CardPlace["kind"]
>

type TargetKind = keyof typeof TARGET_PLACES

/**
 * The container a card of a kind no canvas takes is made in when it is dropped
 * on one: a text card or a reference lands as the first note of a new note
 * column at that spot. The host resolves it (`planMoveTargets`); a kind not
 * here, sent to a spot on a canvas, is refused at the edge as any target its
 * kind is never sent to is.
 */
export const WRAPS = {
  text: "note-column",
  reference: "note-column",
} as const satisfies Partial<Record<CardKind, CardKind>>

/** The kinds a drop on a canvas makes a container for (`WRAPS`). */
export type WrappedKind = keyof typeof WRAPS

/** The container `kind` is made in on a canvas (`WRAPS`); null for a kind with none. */
export const wrapperKind = (
  kind: CardKind,
): (typeof WRAPS)[WrappedKind] | null =>
  kind in WRAPS ? WRAPS[kind as WrappedKind] : null

/**
 * The targets that resolve to a place a card of `K` is ever in, and a spot
 * on a canvas for a kind made into a container there (`WRAPS`).
 */
type TargetKindOf<K extends CardKind> =
  | {
      [T in TargetKind]: (typeof TARGET_PLACES)[T] extends (typeof PLACES_OF)[K][number]
        ? T
        : never
    }[TargetKind]
  | (K extends WrappedKind ? "canvas-at" : never)

/** Where a move may send a card of `K`: a key or a target of a place it is ever in. */
export type TargetOf<K extends CardKind> =
  | KeyOf<K>
  | Extract<
      NotesTarget | CanvasTarget | BackTarget | NewCanvasTarget,
      { readonly kind: TargetKindOf<K> }
    >

/** A move of a card of `K`, from and to places that kind is ever in. */
export interface MoveOf<K extends CardKind> extends Move<TargetOf<K>> {
  readonly card: IdOf<K>
  readonly from: KeyOf<K> | null
}

/**
 * A move as the wire decodes it (`typedMove`): by its card's kind, so a
 * thread's card can only be moved between canvases and inventories, and a
 * text card never onto a canvas.
 */
export type TypedMove = MovesOf<CardKind>

/** The moves of a card of each kind in `K`, one `MoveOf` per kind. */
export type MovesOf<K extends CardKind> = K extends CardKind ? MoveOf<K> : never

/** Whether a target is one a card of `kind` may be sent to (`TargetOf`). */
const fitsTarget = (kind: CardKind, to: MoveTarget): boolean => {
  if (to.kind === "canvas-at" && !fitsPlace(kind, "canvas")) {
    const wrap = wrapperKind(kind)
    return wrap !== null && fitsPlace(wrap, "canvas")
  }
  return fitsPlace(kind, placeKindOfTarget(to))
}

/** The kind of place a target lands in: a key's own, or the place `TARGET_PLACES` names. */
const placeKindOfTarget = (to: MoveTarget): CardPlace["kind"] => {
  switch (to.kind) {
    case "notes":
    case "canvas-at":
    case "back":
    case "new-canvas":
      return TARGET_PLACES[to.kind]
    default:
      return to.kind
  }
}

/** Whether `to` is a target a card of `kind` may be sent to (`TargetOf`). */
export const isTargetForKind = <K extends CardKind>(
  kind: K,
  to: MoveTarget,
): to is TargetOf<K> => fitsTarget(kind, to)

/**
 * `move` typed by its card's kind; undefined when its `from` or `to` is a
 * place that kind is never in.
 */
export function typedMove(move: Move): TypedMove | undefined {
  const kind = kindOfCard(move.card)
  if (move.from !== null && !fitsPlace(kind, move.from.kind)) return undefined
  return fitsTarget(kind, move.to) ? (move as TypedMove) : undefined
}

/**
 * `card` at `place`; undefined for a place its kind is never in, so no
 * record of a text card on a canvas can be made.
 */
export function placed(
  card: CardRecord,
  place: CardPlace,
): CardRecord | undefined {
  switch (card.kind) {
    case "text":
      return fits("text", place) ? { ...card, place } : undefined
    case "thread":
      return fits("thread", place) ? { ...card, place } : undefined
    case "canvas":
      return fits("canvas", place) ? { ...card, place } : undefined
    case "note-column":
      return fits("note-column", place) ? { ...card, place } : undefined
    case "fact":
      return fits("fact", place) ? { ...card, place } : undefined
    case "reference":
      return fits("reference", place) ? { ...card, place } : undefined
    case "ask":
      return fits("ask", place) ? { ...card, place } : undefined
  }
}
