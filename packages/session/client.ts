// session/client — what one client's connection offers (`SessionClient`) and
// the requests it sends untracked (`HostRequest`). Types only, from modules
// that hold no connection, so pure code that names them never reaches
// `connect.ts`, which implements them.

import type { Exchange, Undone, UndoStack } from "@kyneta/exchange"
import type { CommitOptions } from "@kyneta/schema"
import type {
  BlobRef,
  CanvasId,
  ConflictChoice,
  EntryId,
  RestorePreview,
  RootId,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import type {
  LiveDocHandle,
  PresenceDocHandle,
  RootDocHandle,
  SessionDocHandle,
  TextDocHandle,
} from "@pinetrie/schema"
import type {
  AcceptedAction,
  AccessAnswer,
  CardCommand,
  CardId,
  CardRecord,
  Intent,
  MessageAt,
  MoveDirection,
  MoveTarget,
  Paste,
  ProposedChangesAction,
  QueueHoldChange,
  QueueMove,
  Reorder,
  Replacing,
  TextCard,
  TextCardId,
  TypedMove,
} from "@pinetrie/threads"
import type { ActingState } from "./acting.ts"
import type { AttentionStore } from "./attention-store.ts"
import type {
  ActedAt,
  CardNotice,
  MoveAnswer,
  MoveHow,
  MovesState,
  SlotMove,
} from "./card-moves.ts"
import type { Slots } from "./inventory.ts"
import type { OpenThreads } from "./open-threads.ts"
import type { SendHow } from "./send.ts"
import type { Readable } from "./store.ts"

/** A blob kept: the host's ref, or its reason. */
export type Upload =
  | { readonly ok: true; readonly ref: BlobRef }
  | { readonly ok: false; readonly reason: string }

/**
 * What a blob is posted from: markdown, or what can be read as bytes. A
 * `Blob` or `File` is one, named structurally so this module names no
 * global the pure config lacks.
 */
export type UploadBody = string | { arrayBuffer(): Promise<ArrayBuffer> }

/** A card to create: the session makes you its owner and placer. */
export type NewCard = Pick<TextCard, "id" | "place" | "content">

/**
 * One card's undo, as its box binds it (`@kyneta/react`'s `attach`), saying
 * what each undo and redo did.
 */
export type CardUndo = Pick<UndoStack, "typing"> & {
  undo(options?: CommitOptions): Promise<Undone>
  redo(options?: CommitOptions): Promise<Undone>
}

export interface SessionClient {
  /** The email this client connected as. */
  readonly principal: string
  /** Keep `body` as a blob on the host (`POST /blob`): its ref, or the reason it was not kept. */
  upload(body: UploadBody): Promise<Upload>
  /** Who this client is to the host: derived from the principal, as the host does. */
  readonly writer: WriterId
  /**
   * The live Exchange and doc, exposed so a React tree can render from the
   * SAME connection this client already owns (via ExchangeProvider) rather
   * than opening a second one, and so Node callers read the same document.
   */
  readonly exchange: Exchange
  /** The session's records, the directory of roots among them. */
  readonly session: SessionDocHandle
  /** What is streaming now: which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /**
   * The roots' documents this client holds: those it was asked to
   * hold (`holdRoots`), and a root it has just started, until then.
   */
  readonly roots: Readable<ReadonlyMap<RootId, RootDocHandle>>
  /**
   * Hold exactly `roots`' documents, and a root this client just started:
   * opened if new, and every other let go (`destroy`), which leaves the
   * host's copy.
   */
  holdRoots(roots: ReadonlySet<RootId>): void
  /** The root a held document has `entry` in, or undefined. */
  rootOf(entry: EntryId): RootId | undefined
  /**
   * Who is here. Write it only through `setReading`,
   * `clearReading` and `setTyping`, which write under this seat's key.
   */
  readonly presence: PresenceDocHandle
  /**
   * Every card's record: the host's, with this tab's moves the
   * copy does not yet hold drawn over them (`withPending`). The places
   * document itself is never exposed, and a write to it throws
   * (`writersPolicy`). Move a card only through `createCard` and `moveCard`,
   * and write its text through its editor.
   */
  readonly cards: Readable<readonly CardRecord[]>
  /**
   * Once this client's copy of the places has settled: what a canvas holds
   * is there, so the roots of the sidebar's canvases can be held.
   */
  placesSettled(): Promise<void>
  /**
   * This tab's undo stack, narrowed to one card: undo and redo take only the
   * steps that wrote its text, its creation among them. The stack
   * itself is not exposed: its own `undo()` takes the tab's last step,
   * wherever that is. It is in memory, so it lasts until the tab reloads or
   * closes. Each undo and redo says what it did (`Undone`).
   */
  undoFor(id: TextCardId): CardUndo
  /**
   * This window's column `columnKey` shows the thread ending at `end`, on
   * the canvas `canvas` (null: not yet known).
   */
  setReading(columnKey: string, end: string, canvas: string | null): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /**
   * This window is typing at `end`, in `card` when it is one already (the
   * host pops no card someone types in). Silence decays it.
   */
  setTyping(end: string, card: CardId | null): void
  /**
   * A human message. `at` is where the sender is reading, or the branch point
   * (only a `branch` starts at the root). It runs the agent only if the agent
   * is its addressee (`address`).
   */
  send(text: string, at: MessageAt, how?: SendHow): Promise<Outcome>
  /**
   * Ask the host for anything this tab does not track and that needs no
   * root found: a name, a stop, a reservation, an archive or a restore, a
   * card's command. Each kind is documented on core's
   * `Intent`.
   */
  request(intent: HostRequest): Promise<Outcome>
  /**
   * A card's text: the same document for every caller. Call it only for a
   * card whose record is live: once the host has spent the card, this client
   * destroys its copy (`hostLetGo`, `spentCards`), and a call then would make
   * a new, empty one.
   */
  cardText(id: TextCardId): TextDocHandle
  /**
   * Create a card holding `text`: its text in one undo step, so undoing past
   * the first keystroke empties it, and a request that the host place it,
   * then one for its command when it has one. Into your
   * inventory, `how.slot` is the slot it takes.
   */
  createCard(card: NewCard, text: string, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Paste: a text card's `text` written first, as a creation's
   * is, then one request that trashes the card it replaces and
   * makes the pasted card where `to` is, or moves a cut card out of your
   * trash there. Drawn there, and the replaced card gone, until the host
   * answers. Into your inventory, `how.slot` is the slot it takes.
   */
  paste(
    pasted: {
      readonly paste: Paste
      readonly to: MoveTarget
      readonly replacing: Replacing | null
      readonly here: CanvasId | null
      /** A pasted text card's text; "" for any other paste. */
      readonly text: string
    },
    how?: MoveHow,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to move a card, as the page planned it: a take
   * into the inventory, a put, an unqueue, or a trash (to gone); a queue is
   * `queueCard`. Into your inventory with `how.slot`, the slot is written once the host
   * accepts, before the answer is recorded, so the repair never sees the
   * card held without its slot. `queuedBy`, for an unqueue, is who queued
   * the card: if the host popped it first, the refusal says it was sent, as
   * theirs. `here`, the canvas this tab is on, names the history of a
   * trash from your inventory. Resolves with the host's answer.
   */
  moveCard(
    move: TypedMove,
    how?: MoveHow,
    queuedBy?: WriterId | null,
    here?: CanvasId | null,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to queue a card: `move` into a queue, sent with
   * its text's version as this client has it then, and what it does to
   * that queue's hold, which the host decides with the move in one step.
   * A move with no `from` makes the card in the queue, empty, carrying
   * `command`: it never passes through another place. A card that exists
   * takes `command` in the same write. Drawn queued at once;
   * resolves with the host's answer.
   */
  queueCard(
    move: QueueMove,
    hold: QueueHoldChange,
    how?: MoveHow,
    command?: CardCommand | null,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to move a queued or pinned card among its neighbours, as
   * the page saw them, drawn there at once. Resolves with
   * the host's answer; a refusal is kept where you acted.
   */
  reorderCard(reorder: Reorder, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Hand several cards at once, as one move the host accepts or refuses
   * whole (a keep), each with the slot it takes; `here`, as
   * `moveCard`'s.
   */
  moveCards(
    moves: readonly [SlotMove, ...SlotMove[]],
    actedAt: ActedAt,
    here?: CanvasId | null,
  ): Promise<MoveAnswer>
  /**
   * Undo or redo your newest move in `canvas`, or outside any canvas for none:
   * the host's history of your moves there, from any of your tabs.
   */
  undoMoves(canvas: CanvasId | null, direction: MoveDirection): Promise<Outcome>
  /**
   * Swap two slots of your inventory, in one write, as one step of this
   * tab's swaps; no host is asked.
   */
  swapSlots(a: number, b: number): void
  /**
   * Undo or redo this tab's newest swap, whole or refused: refused, said at
   * the inventory, when the slots it wrote have changed since.
   */
  undoSwap(direction: MoveDirection): Promise<void>
  /** Keep a refusal: one made before anything was sent, or an undo's. */
  refuse(refusal: CardNotice): void
  /** You acted at `at` with no move of a card: the notices there go (a move on the board). */
  acted(at: ActedAt): void
  /** This tab's moves: in flight and refused (`card-moves.ts`). */
  readonly moves: Readable<MovesState>
  /**
   * Your inventory's slots as your document holds them, repaired from the
   * host's record on every change (`repairStep`). Written only by your own
   * tabs: the repair, the answer to a take into the inventory, and
   * `swapSlots`.
   */
  readonly slots: Readable<Slots>
  /**
   * What you have dealt with, on every device of yours: how far
   * you have read each thread, what you marked "not needed", the mentions
   * you have seen.
   */
  readonly attention: AttentionStore
  /**
   * The sidebar: the roots you have open, in your order, on every device of
   * yours. A root moved to the archive leaves it, but the one
   * the page reports it shows (`here`).
   */
  readonly openThreads: OpenThreads
  /**
   * An action on a lane's proposed changes in your repo; an acceptance names
   * its destination bookmark, null for the default, and the proposed changes as
   * this tab's record shows it (`proposedChangesSeen`). Tracked in `acting`.
   */
  proposed(
    lane: ThreadId,
    action: ProposedChangesAction,
    to?: string | null,
  ): Promise<Outcome>
  /** Set up accepted work, or publish it. Tracked in `acting`. */
  actOnAccepted(action: AcceptedAction): Promise<Outcome>
  /**
   * A folder project's kept state written back into its folder, as its
   * preview drew it: `of` the state, `from` accepted work's newest the
   * preview was drawn from, sent as what was shown. Tracked in `acting`.
   */
  restore(preview: RestorePreview): Promise<Outcome>
  /** `lane`'s conflict at `path` closed with `choose`'s version. Tracked in `acting`. */
  resolve(
    lane: ThreadId,
    path: string,
    choose: ConflictChoice,
  ): Promise<Outcome>
  /** Your answer to `lane`'s use of your ssh identity. Tracked in `acting`. */
  access(lane: ThreadId, answer: AccessAnswer): Promise<Outcome>
  /** Your proposed changes, setup and publish commands out now, or refused or failed (`acting.ts`). */
  readonly acting: Readable<ActingState>
  /** Let go of every part, then shut the exchange down; rejects only when that fails. */
  close(): Promise<void>
}

/**
 * What the host is asked for that is neither tracked nor needs a root found: a
 * chat, a move and a reorder are tracked in `moves`, an undo of moves waits for
 * this tab's copy of the places, and an action on proposed changes and set up
 * or publish are tracked in `acting`.
 */
export type HostRequest = Exclude<
  Intent,
  {
    kind:
      | "send"
      | "move"
      | "reorder"
      | "undo-move"
      | "proposed"
      | "setup"
      | "publish"
  }
>
