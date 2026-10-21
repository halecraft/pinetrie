// threads/intents — every command a client sends (`Intent`), and how a send
// continues the tree (`MessageAt`, `SendMode`).

import type {
  CanvasId,
  ConflictChoice,
  EntryId,
  PointId,
  ProposedChangesSeen,
  RootId,
  Sha256,
  ThreadId,
  WorkflowStateId,
} from "@pinetrie/core"
import type { AccessAnswer } from "./access.ts"
import type { WorkflowEdit } from "./board.ts"
import type { CardId, ImageId, MediaId } from "./card-ids.ts"
import type { CardCommand } from "./cards.ts"
import type { MarkTarget } from "./marks.ts"
import type { Mention } from "./mentions.ts"
import type { Paste, Replacing } from "./paste.ts"
import type {
  CanvasKey,
  CardWidth,
  ImagesTarget,
  Move,
  MoveDirection,
  MoveOf,
  MoveTarget,
  PlaceKey,
  QueueHoldChange,
  QueueMove,
  Reorder,
  SentCard,
  TypedMove,
} from "./places.ts"
import type { BranchOut } from "./threads.ts"

/**
 * How a client's message means to join the tree.
 *
 * - `reply`: continue the thread I am reading. If another writer compelled
 *   the agent there since I saw it, that is a race, and the sender is told
 *   (`conflict`) rather than guessed for.
 * - `branch`: start a thread, at the root or any message. Every thread starts
 *   this way, and a branch never continues an existing lane: a compelled one is
 *   a new line of work.
 */
export type SendMode = "reply" | "branch"

/**
 * Where a message goes. A send at a thread's `end` names the thread and the
 * entry its sender saw as its end; the host finds the end (`threadEnd`). A
 * `branch` names the new thread the sender's column minted, where it forks (an
 * entry, or null for a thread at the root), and the canvas its card goes in: a
 * new one the sender's tab minted for a new root, else the canvas its column is
 * on. So no send can land anywhere but a thread's end without starting a
 * thread, no thread's end ever gets two continuations, and no thread starts
 * without a place.
 */
export type MessageAt =
  | {
      readonly kind: "end"
      readonly thread: ThreadId
      readonly seen: EntryId
    }
  | {
      readonly kind: "branch"
      readonly thread: ThreadId
      readonly at: EntryId | null
      readonly canvas: CanvasId
    }

/** A send's mode, from where it goes. */
export const chatMode = (at: MessageAt): SendMode =>
  at.kind === "end" ? "reply" : "branch"

/**
 * How the host plans a message: a client's mode, or `queue`, for a queued card
 * it pops. The lane's queue has already decided that card's turn, so only a run
 * makes the lane busy, and a race does not count. A client never sends it: it
 * queues a card instead.
 */
export type PlanMode = SendMode | "queue"

/**
 * Where the host sends a message: where a client's goes (`MessageAt`), or the
 * end of the thread whose queued card it pops.
 */
export type SendAt =
  | MessageAt
  | { readonly kind: "queue"; readonly thread: ThreadId }

/** A chat the host sends: a `chat` command's, or a popped queued card's. */
export type Send = Omit<Extract<Intent, { readonly kind: "send" }>, "at"> & {
  readonly at: SendAt
}

/** What the command gate decides on: a person's command, or a send made for one. */
export type Gated = Intent | Send

/** How the host plans a send, from where it goes. */
export const planMode = (at: SendAt): PlanMode =>
  at.kind === "queue" ? "queue" : chatMode(at)

/**
 * How an opened thread starts. A branch at `at` in its root, its card just
 * after the thread `at` is in. A new canvas's: a new root's first thread in a
 * new canvas, which lands in `state` (Topics for null). A new
 * root's first thread in a canvas the session holds, its card just after
 * `after` (first for null; at the end when `after` has left the canvas).
 */
export type ThreadStart =
  | { readonly kind: "branch"; readonly at: EntryId }
  | { readonly kind: "new-canvas"; readonly state: WorkflowStateId | null }
  | { readonly kind: "new-root"; readonly after: CardId | null }

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule, so this type cannot express a
 * malformed command. What it then does is decided by `planMessage` and the
 * other planners in `@pinetrie/rules`, over what the host gathers.
 */
/** One image a put makes: its id, the blob it was uploaded as, and its file's name. */
export interface PutImage {
  readonly card: ImageId
  readonly sha256: Sha256
  readonly name: string
}

export type Intent =
  /** A human message; `mentions` are parsed from `text` once, at the codec. */
  | {
      readonly kind: "send"
      readonly text: string
      /**
       * The root it is written in: a new one the sender's tab minted for a
       * thread at the root.
       */
      readonly root: RootId
      readonly at: MessageAt
      readonly mentions: readonly Mention[]
      /**
       * The card the text was sent from, spent once it is written or running,
       * or queued when the lane is busy.
       */
      readonly card: SentCard | null
      /**
       * Each card pinned at the sender's thread end, with its text version as
       * the sender had it: a run waits for them.
       */
      readonly pinned: readonly SentCard[]
      /**
       * The WIP bookmark a lane this message creates starts from; null for the
       * line. Read only when the message creates a lane.
       */
      readonly base: string | null
      /**
       * The workflow state a root this message starts lands in, at its end;
       * null for Topics. Read only when it starts one.
       */
      readonly state: WorkflowStateId | null
    }
  /** Name a thread before its lane exists. */
  | { readonly kind: "reserve"; readonly lane: ThreadId }
  /** Set the sender's display name: a label, never an identity. */
  | { readonly kind: "name"; readonly name: string }
  /** Set the sender's picture to a stored blob, or with null remove it. */
  | { readonly kind: "picture"; readonly sha256: Sha256 | null }
  /** End a thread's running turn. Idempotent: an idle lane is already stopped. */
  | { readonly kind: "stop"; readonly lane: ThreadId }
  /** Start a new turn on a thread whose last ask was stopped. */
  | { readonly kind: "carry-on"; readonly lane: ThreadId }
  /** The owner's answer to a lane's use of their ssh identity. */
  | {
      readonly kind: "ssh-access"
      readonly lane: ThreadId
      readonly answer: AccessAnswer
    }
  /**
   * Hold a thread's queue, or release it: while it is held, no message card
   * queued there is popped.
   */
  | {
      readonly kind: "queue-hold"
      readonly lane: ThreadId
      readonly held: boolean
    }
  /**
   * Queue a card: `move` into a lane's queue, and what it does to that queue's
   * hold, decided with the move in one step. A move with no `from` creates the
   * card there; either way the card carries `command` in the move's own
   * write, so the drain the queueing starts pops it with its command.
   */
  | {
      readonly kind: "queue-card"
      readonly move: QueueMove
      readonly hold: QueueHoldChange
      /** The queued card's command; null leaves a card that exists as it is. */
      readonly command: CardCommand | null
    }
  /** Take every message card queued on a thread back below the line. */
  | { readonly kind: "unqueue-all"; readonly lane: ThreadId }
  /**
   * Make a text card a thread: a new chat's root, `root`, its thread
   * `thread`, whose first message is the card's text, in a new canvas, `canvas`, in
   * `state`, or Topics for null; the card goes to the trash, in
   * the history `here` names when it leaves no canvas.
   */
  | {
      readonly kind: "spin-off"
      readonly move: Move<Extract<PlaceKey, { readonly kind: "trash" }>>
      readonly root: RootId
      readonly thread: ThreadId
      readonly canvas: CanvasId
      readonly state: WorkflowStateId | null
      /**
       * The canvas its sender will be on, which names the move's history for a
       * card from an inventory: the new canvas for a drop in the sidebar, else
       * the one they are on.
       */
      readonly here: CanvasId | null
    }
  /**
   * Move a canvas on the board: from the state its sender saw it in, to `to`,
   * before `before` there, or at its end. Into the archive it archives the
   * canvas, and out of it restores the canvas.
   */
  | {
      readonly kind: "move-canvas"
      readonly canvas: CanvasId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: CanvasId | null
    }
  /** Change the session's workflow states. */
  | { readonly kind: "workflow"; readonly edit: WorkflowEdit }
  /**
   * Title a canvas or a titled card, or clear its title with null: one
   * gesture, a canvas's title in its mark and a card's in its title record.
   */
  | {
      readonly kind: "mark"
      readonly of: MarkTarget
      readonly title: string | null
    }
  /** Ask a model for a canvas's title, from its first thread's messages. */
  | { readonly kind: "retitle"; readonly canvas: CanvasId }
  /**
   * Act on a lane's proposed changes in your repo. An acceptance names its
   * destination bookmark, null for the default, and what it was shown (`seen`);
   * every other action, null.
   */
  | {
      readonly kind: "proposed"
      readonly lane: ThreadId
      readonly action: ProposedChangesAction
      readonly to: string | null
      readonly seen: ProposedChangesSeen | null
    }
  /** Set up accepted work, or publish it. */
  | { readonly kind: AcceptedAction }
  /**
   * Restore a folder project's kept state `of` into its folder, as its
   * preview showed it: `seen` is accepted work's newest the preview was
   * drawn from.
   */
  | {
      readonly kind: "restore"
      readonly of: PointId
      readonly seen: PointId
    }
  /** Close a folder lane's conflict at `path` with `choose`'s version. */
  | {
      readonly kind: "resolve"
      readonly lane: ThreadId
      readonly path: string
      readonly choose: ConflictChoice
    }
  /**
   * Move cards, create one, or remove one: one move, or a keep's several,
   * accepted whole or refused. The host records it in a canvas's history of the
   * sender's moves (`movesHistory`); `here`, the canvas its sender is on, is a
   * trash's from an inventory.
   */
  | {
      readonly kind: "move"
      readonly moves: readonly TypedMove[]
      readonly here: CanvasId | null
    }
  /**
   * Open a thread before its first entry, as its column opens: its record, and
   * its card on `canvas`'s canvas, as `start` says.
   */
  | {
      readonly kind: "open-thread"
      readonly thread: ThreadId
      readonly root: RootId
      readonly canvas: CanvasId
      readonly start: ThreadStart
    }
  /**
   * Open a branch for each row pressed on an agent's proposal, at its fork,
   * after the proposing thread in the proposal's order; Start also sends each
   * one's brief as the sender's message to the agent. Rows are strictly
   * increasing and threads distinct, as the codec decodes them.
   */
  | BranchOut
  /**
   * Copy the thread `source`: a new thread, its id the move's card, forked at
   * `end`, the source's end as its copier saw it, its card made where the move
   * puts it: a spot on a canvas or the copier's inventory. One step of the
   * copier's history, as a paste is.
   */
  | {
      readonly kind: "copy-thread"
      readonly source: ThreadId
      readonly end: EntryId
      readonly move: MoveOf<"thread"> & { readonly from: null }
    }
  /**
   * Paste: make a card from a copy, or move a cut card out of a trash by its
   * cutter, where `to` sends it, after trashing the card it replaces. One
   * step of the sender's history, in the canvas it lands in; `here`, the canvas its
   * sender is on, names a trash's from an inventory.
   */
  | {
      readonly kind: "paste"
      readonly paste: Paste
      readonly to: MoveTarget
      readonly replacing: Replacing | null
      readonly here: CanvasId | null
    }
  /**
   * New images, from blobs already stored, put at a spot on a canvas (a
   * media column made there) or at a media column's end: one step of the
   * sender's history. Each is titled by its file's name.
   */
  | {
      readonly kind: "put-images"
      readonly images: readonly PutImage[]
      readonly to: ImagesTarget
      /**
       * The media column a put to a spot makes, minted by the page so it
       * draws it unfolded for its maker; null to let the host mint it.
       */
      readonly made: MediaId | null
    }
  /** A new version of an image, from a blob already stored. */
  | {
      readonly kind: "version"
      readonly image: ImageId
      readonly sha256: Sha256
    }
  /**
   * Move a queued or pinned card among its neighbours, recorded in its root's
   * history of the sender's moves.
   */
  | { readonly kind: "reorder"; readonly reorder: Reorder }
  /**
   * Draw a card on a canvas one column wide or two, from where its sender saw
   * it (`at`): a compare-and-set, as a reorder is, recorded in the canvas's
   * history of the sender's moves.
   */
  | {
      readonly kind: "card-width"
      readonly card: CardId
      readonly at: CanvasKey
      readonly width: CardWidth
    }
  /**
   * Tick a column's box, or clear it, for everyone, from where its sender
   * saw it (`at`): a compare-and-set, as a width is, recorded in the
   * canvas's history of the sender's moves.
   */
  | {
      readonly kind: "card-tick"
      readonly card: CardId
      readonly at: CanvasKey
      readonly ticked: boolean
    }
  /**
   * Undo or redo the sender's newest move in `canvas`, or, with none, in their
   * history outside any canvas.
   */
  | {
      readonly kind: "undo-move"
      readonly canvas: CanvasId | null
      readonly direction: MoveDirection
    }
  /** Set a card's command, or clear it with null. */
  | {
      readonly kind: "set-command"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * The sender has seen these traces of theirs: the host deletes them. Ids not
   * the sender's are ignored.
   */
  | { readonly kind: "traces-seen"; readonly traces: readonly string[] }

/**
 * What can be done with proposed changes: accept it into accepted work or a
 * WIP, squash a stack back to one revision, have the agent write its
 * description again, or rebuild it, trashing your edits. Splitting it is a
 * card's command, `split`, popped when the thread is free.
 */
export type ProposedChangesAction = "accept" | "squash" | "describe" | "refresh"
export const PROPOSED_CHANGES_ACTIONS: readonly ProposedChangesAction[] = [
  "accept",
  "squash",
  "describe",
  "refresh",
]

/**
 * What can be done with accepted work: set it up at your `@-`, writing your
 * repo's immutable heads, or publish it.
 */
export type AcceptedAction = "setup" | "publish"
