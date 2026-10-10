// places — where cards are (ADR-0048, ADR-0059, ADR-0116): its places and
// their keys, which kinds each takes (`PLACES_OF`), the targets and moves
// between them, reorders, and the places row's fields. What a card is, is
// `cards.ts`'. Re-exported from `index.ts`.

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
  atEntry,
  type CardId,
  type CardKind,
  type EntryId,
  entryId,
  type FactCardId,
  type FileCardId,
  isNoteColumnId,
  isRootId,
  isTaskId,
  isThreadId,
  kindOfCard,
  type MediaId,
  type NoteColumnId,
  type Position,
  parseCardId,
  type ReferenceCardId,
  ROOT,
  type RootId,
  type TaskId,
  type TextCardId,
  type ThreadId,
  type WriterId,
} from "./index.ts"
import { KINDS } from "./kinds.ts"

/**
 * Where a card is (ADR-0113, ADR-0116). Composing: your message, in your
 * composer at a thread's end, which only you see; kept as its thread, and
 * resolved to the thread's end (`placeEnd`) whenever it is needed, so it
 * follows its thread as the thread grows. Note: in a note column, at its
 * rank there, shared by everyone in the task (ADR-0116). Pinned: at the top
 * of a thread's column, kept and resolved the same way; the agent reads it
 * on every run. Queued: above the line, waiting for its thread's lane, until
 * the host pops it or someone unqueues it. Margin: beside an entry, a
 * comment on it, shared by everyone in the task and never read by the agent
 * (ADR-0126); it names the entry's thread too, so its task is found without
 * reading a tree. Fresh: an unsent branch or new
 * tab, by its column's key, in the root it will start or branch in and the
 * task its column is on. Canvas: a thread card or a note column in a
 * task, at its rank there: the only record of where it is,
 * so a card has one place by construction. Inventory: in its holder's
 * inventory; which slot holds it is the holder's own document
 * (`InventoryDoc`), not the host's (ADR-0059). Gone: discarded, drawn
 * nowhere, kept so the undo key can bring it back until the host sweeps it
 * (ADR-0111).
 */
export type CardPlace =
  | {
      readonly kind: "composing"
      /**
       * Its thread, whose end it is at: every entry names its thread
       * (ADR-0125), so the end is found from it alone.
       */
      readonly thread: ThreadId
    }
  | {
      readonly kind: "note"
      /** The note column it is in (ADR-0116). */
      readonly column: NoteColumnId
      /** Its rank in the column: an order key (S69), the host's to give. */
      readonly order: string
    }
  | {
      readonly kind: "pinned"
      readonly thread: ThreadId
      /** Sorts the thread's pinned cards, in the order they were pinned. */
      readonly order: string
    }
  | {
      readonly kind: "task-pinned"
      /** The task it is pinned to: every thread of it reads it (ADR-0116). */
      readonly task: TaskId
      /** Sorts the task's pinned cards, in the order they were pinned. */
      readonly order: string
    }
  | {
      readonly kind: "queued"
      /** Its thread, whose lane pops it. */
      readonly thread: ThreadId
      /** Sorts the lane's queue; ties go by id (S69). */
      readonly order: string
      /** Who queued it: its message's author. */
      readonly by: WriterId
      /**
       * The text's version as its queuer had it (`textVersion`), "" for none:
       * the host pops the card only once it holds that much (S96).
       */
      readonly seen: string
    }
  | {
      readonly kind: "margin"
      /** The entry it comments on. */
      readonly entry: EntryId
      /** The entry's thread (ADR-0125): its task's, read without a tree. */
      readonly thread: ThreadId
      /** Its rank among the entry's comments: an order key (S69), the host's to give. */
      readonly order: string
    }
  | {
      readonly kind: "fresh"
      readonly column: string
      /**
       * The root its column is in (ADR-0063): a branch's tab's root, or the
       * root a new tab minted as it opened.
       */
      readonly root: RootId
      /**
       * The task its column is on: a new tab's, minted as it opened. The
       * host reads a move's history from it (`historyOf`).
       */
      readonly task: TaskId
      /** Where its first send writes: the branch point, or the root for a new tab. */
      readonly at: Position
    }
  | {
      readonly kind: "canvas"
      readonly task: TaskId
      /** Its rank on the task's canvas: an order key (S69), the host's to give. */
      readonly order: string
      readonly width: CardWidth
    }
  | { readonly kind: "inventory"; readonly holder: WriterId }
  | {
      readonly kind: "gone"
      /**
       * The task whose history of moves the discard is in: the one its
       * discarder was on; null for none, and then nothing undoes it.
       */
      readonly task: TaskId | null
      /** Who discarded it. */
      readonly by: WriterId
      readonly why: GoneWhy
    }

/** How many columns a card on a canvas is drawn across (ADR-0116). */
export type CardWidth = 1 | 2

/**
 * Why a card is gone: the stored kind of its place. Discarded; or spun off
 * into `thread`, a conversation root it started (ADR-0111), whose undo
 * lifts the root back into the card while it holds that first message
 * alone.
 */
export type GoneWhy =
  | { readonly kind: "discarded" }
  /** Spun into a new root, `into`, as the first message of `thread`. */
  | {
      readonly kind: "spun"
      readonly into: RootId
      readonly thread: ThreadId
    }

/**
 * The card a chat is sent from, with its text's version as its sender had it
 * (`textVersion`): queued, the host pops it only once it holds that much
 * of the text (S96).
 */
export interface SentCard {
  readonly id: TextCardId
  readonly seen: string
}

type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Where a card is, without what the host assigns when it queues, pins or
 * places one (its order, who queued it, a canvas card's width). A move
 * compares it and targets it. A queued key keeps its text's version
 * (`seen`), which the queuer sends with the move (S96).
 */
export type PlaceKey =
  | OmitEach<
      Exclude<CardPlace, { readonly kind: "gone" }>,
      "order" | "by" | "width"
    >
  /** A discard names no history: the host's to decide (`historyOf`, ADR-0066). */
  | { readonly kind: "gone"; readonly why: GoneWhy }

/**
 * A move's target alone, never where a card is: the note column nearest
 * `thread`'s card in its task, or nearest `task`'s own column, which stands
 * before every card (`nearestNoteColumn`). The host resolves it before it
 * plans the move, making a column when the task has none (ADR-0116).
 */
export type NotesTarget =
  | {
      readonly kind: "notes"
      readonly near: "thread"
      readonly thread: ThreadId
    }
  | { readonly kind: "notes"; readonly near: "task"; readonly task: TaskId }

/**
 * A drop on a canvas (ADR-0116): a move's target alone, never where a card
 * is: `task`'s canvas just after the card `after`, null for before every
 * card. The host ranks it there before it plans the move (`planMoveTargets`);
 * an `after` no longer on that canvas lands it at the end, a hint and not a
 * compare-and-set. Its own kind, so a target not yet ranked is never taken
 * for a canvas's key.
 */
export interface CanvasTarget {
  readonly kind: "canvas-at"
  readonly task: TaskId
  readonly after: CardId | null
}

/** Where a move sends a card: a place's key, a thread's nearest notes, or a spot on a canvas. */
export type MoveTarget = PlaceKey | NotesTarget | CanvasTarget

/** A canvas's key with the rank a drop was given there (`CanvasTarget`, resolved). */
export interface RankedCanvas {
  readonly kind: "canvas"
  readonly task: TaskId
  readonly order: string
}

/** A place's key: the same kind of place, with what the host assigns left out. */
export function keyOf<P extends CardPlace>(
  place: P,
): Extract<PlaceKey, { readonly kind: P["kind"] }>
export function keyOf(place: CardPlace): PlaceKey {
  switch (place.kind) {
    case "composing":
      return place
    case "note":
      return { kind: "note", column: place.column }
    case "pinned":
      return { kind: "pinned", thread: place.thread }
    case "task-pinned":
      return { kind: "task-pinned", task: place.task }
    case "queued":
      return { kind: "queued", thread: place.thread, seen: place.seen }
    case "margin":
      return { kind: "margin", entry: place.entry, thread: place.thread }
    case "canvas":
      return { kind: "canvas", task: place.task }
    case "fresh":
    case "inventory":
      return place
    case "gone":
      return { kind: "gone", why: place.why }
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
    case "task-pinned":
      return b.kind === "task-pinned" && a.task === b.task
    case "queued":
      return b.kind === "queued" && a.thread === b.thread
    // An entry names its thread, so the entry alone says which margin.
    case "margin":
      return b.kind === "margin" && a.entry === b.entry
    case "canvas":
      return b.kind === "canvas" && a.task === b.task
    // A column's key names it, wherever it is.
    case "fresh":
      return b.kind === "fresh" && a.column === b.column
    case "inventory":
      return b.kind === "inventory" && a.holder === b.holder
    case "gone":
      return (
        b.kind === "gone" &&
        a.why.kind === b.why.kind &&
        (a.why.kind !== "spun" ||
          (b.why.kind === "spun" &&
            a.why.into === b.why.into &&
            a.why.thread === b.why.thread))
      )
  }
}

/**
 * Whether a card at `now` is where a move's sender saw it, `from`. A card
 * on its way to a thread's nearest notes is drawn where the host would put
 * it, or where it was (`drawnPlace`), so its sender never sees it at a
 * target.
 */
export const seenAt = (now: PlaceKey, from: PlaceKey): boolean =>
  sameKey(now, from)

/**
 * What queueing a card does to its queue's hold (ADR-0113): nothing; hold an
 * idle queue first, so a card staged there is not sent while it is written;
 * or release it, so the card is sent after those queued before it.
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
 * A handoff (ADR-0059): move a card from where its sender saw it to another
 * place. `from` null creates the card. Nobody removes one: a discard is a
 * move to gone (ADR-0111), and only the host deletes a record, for a card it
 * sends or sweeps.
 */
export interface Move<To extends MoveTarget = MoveTarget> {
  readonly card: CardId
  readonly from: PlaceKey | null
  readonly to: To
}

/**
 * Where a move the host plans sends a card: a place's key, but a canvas's
 * with the rank it was given there (`RankedCanvas`), so no card lands on a
 * canvas unranked.
 */
export type ResolvedTarget =
  | Exclude<PlaceKey, { readonly kind: "canvas" }>
  | RankedCanvas

/**
 * A move to a place: every move the host plans, once a thread's nearest
 * notes and a spot on a canvas are resolved (`planMoveTargets`), so
 * `planMove` cannot be given an unresolved one, nor a canvas with no rank.
 */
export type ResolvedMove = Move<ResolvedTarget>

/** A canvas's key: where a card on a task's canvas is, its rank and width left out. */
export type CanvasKey = Extract<PlaceKey, { readonly kind: "canvas" }>

/** A queue's key: where a card is queued, its text's version as its queuer had it. */
export type QueuedKey = Extract<PlaceKey, { readonly kind: "queued" }>

/** A move into a queue: a `queue-card`'s, which changes the queue's hold with it. */
export type QueueMove = Move<QueuedKey>

/**
 * The places a reorder moves a card among (ADR-0048 step 7, ADR-0116): a
 * queue, a thread's pinned cards, a task's pinned cards, a note column, an
 * entry's margin (ADR-0126), or a task's canvas. Each has its rule in `@pinetrie/rules`' `REORDERS`.
 */
export const REORDER_PLACES = [
  "queued",
  "pinned",
  "task-pinned",
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
export const isReorderAt = (key: PlaceKey): key is ReorderAt => {
  const kinds: readonly PlaceKey["kind"][] = REORDER_PLACES
  return kinds.includes(key.kind)
}

/** A place with a rank among its neighbours: every one with an `order`. */
export type OrderedPlace = Extract<CardPlace, { readonly order: string }>

/**
 * A card's new place among its neighbours, as its sender saw them (ADR-0048
 * step 7): what a card does in its place, not a move between places. It
 * stays in the same queue, among the same pinned cards, in the same note
 * column, or on the same canvas (ADR-0116).
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
export function moveOf<To extends TargetOf<"text">>(
  card: TextCard,
  to: To,
): MoveOf<"text"> & { readonly to: To }
export function moveOf<To extends TargetOf<"thread">>(
  card: ThreadCard,
  to: To,
): MoveOf<"thread"> & { readonly to: To }
export function moveOf<To extends TargetOf<"reference">>(
  card: ReferenceCard,
  to: To,
): MoveOf<"reference"> & { readonly to: To }
export function moveOf<To extends TargetOf<"note-column">>(
  card: NoteColumnCard,
  to: To,
): MoveOf<"note-column"> & { readonly to: To }
export function moveOf(
  card: TextCard | ThreadCard | ReferenceCard,
  to: Extract<PlaceKey, { readonly kind: "inventory" }>,
): TypedMove
export function moveOf(
  card: ThreadCard | NoteColumnCard | TextCard | ReferenceCard,
  to: CanvasTarget,
): TypedMove
export function moveOf(
  card: TextCard | ReferenceCard,
  to: NotesTarget | Extract<PlaceKey, { readonly kind: "gone" }>,
): TypedMove
export function moveOf(card: CardRecord, to: MoveTarget): Move {
  return { card: card.id, from: keyOf(card.place), to }
}

/**
 * Where an unqueue or an unpin puts a card, and where your message goes to
 * the notes: the note column nearest its thread, which the host resolves
 * (`notes`, ADR-0116). The one way a card at a thread becomes a note.
 */
export const noteOf = (
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
 * Where a discard puts a card (ADR-0111): gone. Which history it is in is
 * the host's to name (`historyOf`), from where the card leaves.
 */
export const DISCARDED: Extract<PlaceKey, { readonly kind: "gone" }> = {
  kind: "gone",
  why: { kind: "discarded" },
}

/**
 * Where a pin puts your message or a queued card: pinned at the same thread
 * end. Null for any other place: a note and a fresh column have no thread
 * to pin it to.
 */
export const pinnedOf = (
  place: CardPlace | PlaceKey,
): Extract<PlaceKey, { readonly kind: "pinned" }> | null =>
  place.kind === "composing" || place.kind === "queued"
    ? { kind: "pinned", thread: place.thread }
    : null

/** Why the host refused a move (ADR-0059). */
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
   * An undo that would lift back a thread a card was spun into (ADR-0111),
   * after someone wrote there, or the agent started on it.
   */
  | "replied"
  /**
   * A card moved to a place its kind is never in (`KINDS`): a text card on
   * a canvas, a thread's card into a queue, a fact out of its queue.
   */
  | "no-place"

/** Any refusal of a change of place, as the wire carries it: a move's or a reorder's. */
export type PlaceRefusal = MoveRefusal | ReorderRefusal

/** Why the host refused a reorder (ADR-0048 step 7): never a move's answer. */
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
   * A fact (ADR-0080), which no reorder moves, or a card that would pass
   * one: a fact says what already happened, so nothing queued jumps ahead
   * of it.
   */
  | "fact"

/**
 * A place as flat strings, "" for none: how the places document stores it,
 * and how the wire carries a key. `placeFields` writes this shape, and
 * `placeOfFields` and `keyOfFields` read it.
 */
export interface PlaceFields {
  readonly kind: string
  /** A fresh column's root (ADR-0063); "" for every other place. */
  readonly root: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly holder: string
  /** A canvas card's, a fresh column's or a gone card's task (ADR-0116). */
  readonly task: string
  /** A canvas card's width, `1` or `2`. */
  readonly width: string
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
  root: { key: "always" },
  at: { key: "always" },
  lane: { key: "always" },
  column: { key: "always" },
  order: { key: "never" },
  by: { key: "never" },
  seen: { key: "always" },
  holder: { key: "always" },
  // A gone key names no task: the host names a discard's history.
  task: {
    key: "for",
    kinds: ["fresh", "canvas", "canvas-at", "task-pinned", "notes"],
  },
  width: { key: "never" },
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
export const keyFieldsOf = (fields: PlaceFields): Partial<PlaceFields> =>
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
 * - your message is stored as `drafting` (ADR-0113), a thread's id in
 *   `lane` (a lane is named by its thread), its root the thread's;
 * - a thread's nearest notes, its id in `lane`; a task's, its id in `task`;
 * - a spot on a canvas, the card it goes after in `column` ("" for first);
 * - a comment, its entry in `at` and the entry's thread in `lane`;
 * - a gone card, under its reason, who discarded it in `holder`, a spun
 *   card's thread in `lane` and its root in `column`.
 */
const ROWS = {
  drafting: ["lane"],
  note: ["column", "order"],
  notes: ["lane", "task"],
  "task-pinned": ["task", "order"],
  "canvas-at": ["task", "column"],
  pinned: ["lane", "order"],
  queued: ["lane", "order", "by", "seen"],
  margin: ["at", "lane", "order"],
  fresh: ["root", "task", "at", "column"],
  canvas: ["task", "order", "width"],
  inventory: ["holder"],
  discarded: ["task", "holder"],
  spun: ["task", "lane", "column", "holder"],
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
export const rowFieldsOf = (kind: string): readonly string[] | undefined =>
  kind in ROWS ? ROWS[kind as RowKind] : undefined

const entryOrEmpty = (at: Position): string => (at.kind === "root" ? "" : at.id)

/**
 * A place (or a key, whose `order`, `by` and `width` are "", or a move's
 * target) as flat strings, each kind's row as `ROWS` has it.
 */
export function placeFields(place: CardPlace | MoveTarget): PlaceFields {
  switch (place.kind) {
    // Your message keeps the stored kind it had as a drafting card, so no
    // stored row changed with the split (ADR-0113).
    case "composing":
      return row("drafting", { lane: place.thread })
    case "note":
      return row("note", {
        column: place.column,
        order: "order" in place ? place.order : "",
      })
    case "notes":
      return place.near === "thread"
        ? row("notes", { lane: place.thread, task: "" })
        : row("notes", { lane: "", task: place.task })
    case "task-pinned":
      return row("task-pinned", {
        task: place.task,
        order: "order" in place ? place.order : "",
      })
    case "canvas-at":
      return row("canvas-at", { task: place.task, column: place.after ?? "" })
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
    case "fresh":
      return row("fresh", {
        root: place.root,
        task: place.task,
        at: entryOrEmpty(place.at),
        column: place.column,
      })
    case "canvas":
      return row("canvas", {
        task: place.task,
        order: "order" in place ? place.order : "",
        width: "width" in place ? String(place.width) : "",
      })
    case "inventory":
      return row("inventory", { holder: place.holder })
    case "gone": {
      const task = "task" in place ? (place.task ?? "") : ""
      const holder = "by" in place ? place.by : ""
      return place.why.kind === "spun"
        ? row("spun", {
            task,
            holder,
            lane: place.why.thread,
            column: place.why.into,
          })
        : row("discarded", { task, holder })
    }
  }
}

/** A gone row -> why it is gone; undefined for a spun one with no thread. */
const goneWhyOf = (
  r: Extract<Row, { kind: "discarded" | "spun" }>,
): GoneWhy | undefined =>
  r.kind === "spun"
    ? isRootId(r.column) && isThreadId(r.lane)
      ? { kind: "spun", into: r.column, thread: r.lane }
      : undefined
    : { kind: "discarded" }

/** A stored width -> a card's width; undefined for any other. */
const widthOf = (width: string): CardWidth | undefined =>
  width === "1" ? 1 : width === "2" ? 2 : undefined

/** A gone card's stored task: "" is none; undefined for one that is no task. */
const goneTaskOf = (task: string): TaskId | null | undefined =>
  task === "" ? null : isTaskId(task) ? task : undefined

/** A place at a thread: its `thread`, from the row's `lane`; undefined for none. */
const atThread = (r: {
  readonly lane: string
}): { readonly thread: ThreadId } | undefined =>
  isThreadId(r.lane) ? { thread: r.lane } : undefined

/**
 * Flat strings -> a place; undefined for one that is malformed. A card at a
 * thread's end, pinned or queued names its thread alone; a fresh card's `at`
 * is an entry or the root, and it needs its root. A canvas
 * card and a fresh one need their `TaskId`. A fresh card's column is never
 * "", nor an inventory card's holder. A pinned card needs its order, and a
 * canvas card its order and width. A queued card needs its order and who
 * queued it. A note needs its column and its order. A target's row is no
 * place.
 */
export function placeOfFields(f: PlaceFields): CardPlace | undefined {
  const r = rowOf(f)
  switch (r?.kind) {
    case undefined:
    case "notes":
    case "canvas-at":
      return undefined
    case "fresh":
      return r.column === "" || !isRootId(r.root) || !isTaskId(r.task)
        ? undefined
        : {
            kind: "fresh",
            column: r.column,
            root: r.root,
            task: r.task,
            at: r.at === "" ? ROOT : atEntry(entryId(r.at)),
          }
    case "canvas": {
      const width = widthOf(r.width)
      return !isTaskId(r.task) || r.order === "" || width === undefined
        ? undefined
        : { kind: "canvas", task: r.task, order: r.order, width }
    }
    case "note":
      return !isNoteColumnId(r.column) || r.order === ""
        ? undefined
        : { kind: "note", column: r.column, order: r.order }
    case "task-pinned":
      return !isTaskId(r.task) || r.order === ""
        ? undefined
        : { kind: "task-pinned", task: r.task, order: r.order }
    case "inventory":
      return r.holder === ""
        ? undefined
        : { kind: "inventory", holder: r.holder as WriterId }
    case "discarded":
    case "spun": {
      const why = goneWhyOf(r)
      const task = goneTaskOf(r.task)
      return r.holder === "" || task === undefined || why === undefined
        ? undefined
        : { kind: "gone", task, by: r.holder as WriterId, why }
    }
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
 * nor a note's key its order; a gone key names no task, which is the host's
 * to give. A move's target may be a thread's nearest notes (`targetOfFields`).
 */
export function keyOfFields(f: PlaceFields): PlaceKey | undefined {
  const r = rowOf(f)
  switch (r?.kind) {
    case "pinned": {
      const at = atThread(r)
      return at === undefined ? undefined : { kind: "pinned", ...at }
    }
    case "canvas":
      return isTaskId(r.task) ? { kind: "canvas", task: r.task } : undefined
    case "note":
      return isNoteColumnId(r.column)
        ? { kind: "note", column: r.column }
        : undefined
    case "task-pinned":
      return isTaskId(r.task)
        ? { kind: "task-pinned", task: r.task }
        : undefined
    case "discarded":
    case "spun": {
      const why = goneWhyOf(r)
      return why === undefined ? undefined : { kind: "gone", why }
    }
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
        : isTaskId(r.task)
          ? { kind: "notes", near: "task", task: r.task }
          : undefined
    case "canvas-at": {
      if (!isTaskId(r.task)) return undefined
      if (r.column === "")
        return { kind: "canvas-at", task: r.task, after: null }
      const after = parseCardId(r.column)
      return after === undefined
        ? undefined
        : { kind: "canvas-at", task: r.task, after }
    }
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

/** The places a thread card is ever in. */
export type HeldPlace = PlaceOf<"thread">

/** A canvas card's place: a task and a rank there. */
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
} as const satisfies Record<
  (NotesTarget | CanvasTarget)["kind"],
  CardPlace["kind"]
>

type TargetKind = keyof typeof TARGET_PLACES

/**
 * The container a card of a kind no canvas takes is made in when it is
 * dropped on one (ADR-0126): a text card or a reference lands as the first
 * note of a new note column at that spot. The host resolves it
 * (`planMoveTargets`); a kind not here, sent to a spot on a canvas, is
 * refused at the edge as any target its kind is never sent to is.
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
  | Extract<NotesTarget | CanvasTarget, { readonly kind: TargetKindOf<K> }>

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
  return fitsPlace(
    kind,
    to.kind === "notes" || to.kind === "canvas-at"
      ? TARGET_PLACES[to.kind]
      : to.kind,
  )
}

/** Whether `to` is a target a card of `kind` may be sent to (`TargetOf`). */
export const isTargetOf = <K extends CardKind>(
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
