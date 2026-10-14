// core — the vocabulary every package shares (ids, intents, every record's
// type) and the reads of the tree. Nothing here may import pi, Kyneta, or a
// Node builtin (`TECHNICAL.md`).

import type { CardCommand } from "./cards.ts"
import {
  type AgentId,
  type CardId,
  type EntryId,
  type NoteColumnId,
  type RootId,
  type TaskId,
  type TextCardId,
  THE_AGENT,
  type ThreadId,
  type WorkflowStateId,
  type WriterId,
} from "./ids.ts"
import type { Sha256 } from "./images.ts"
import type { OfferLedger, OfferSeen, WorkChanges } from "./offers.ts"
import type { Paste, Replacing } from "./paste.ts"
import type {
  CanvasKey,
  CardWidth,
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
import type { ConfigWidening, TurnShared } from "./runs.ts"
import { isThreadNameHandle } from "./thread-names.ts"

// --- records of threads and tasks -----------------------------------------

/**
 * A thread as the host records it, keyed by its id in the session
 * (`pinetrie.thread`). Its first entry and its end are the tree's: every entry
 * names its thread (`EntryLike.thread`).
 */
export interface ThreadRecord {
  readonly thread: ThreadId
  readonly root: RootId
  /** Who started it. */
  readonly by: WriterId
  /** When, in ms since the epoch. */
  readonly createdAt: number
  readonly origin: ThreadOrigin
}

/**
 * How a thread began: a root's first thread, a root's first thread spun from a
 * text card, or a fork at `at`, a branch or a copy. A fork's source is the
 * thread its entry is in, so it is not stored. Before its first send a thread's
 * column ends at its fork, and its first send branches there.
 */
export type ThreadOrigin =
  | { readonly kind: "root" }
  /**
   * Spun from `card`, which went to its spinner's trash: the undo key
   * lifts the thread back into it while the thread holds that first
   * message alone (`planLiftRoot`).
   */
  | { readonly kind: "spun"; readonly card: TextCardId }
  | ThreadFork

/** A thread forked at an entry: a branch, or a copy, whose fork row says so. */
export interface ThreadFork {
  readonly kind: "fork"
  readonly at: EntryId
  readonly how: "branch" | "copy"
}

/** A root's first thread. */
export const ROOT_ORIGIN: ThreadOrigin = { kind: "root" }

/** The entry a thread forks at, where its first send branches; null for a root's first thread, spun or not. */
export const forkEntry = (origin: ThreadOrigin): EntryId | null =>
  origin.kind === "fork" ? origin.at : null

/**
 * A task as the host records it (`pinetrie.task`, keyed by its id): who
 * opened it, and when. Its cards are where the places document puts them.
 */
export interface TaskRecord {
  readonly task: TaskId
  readonly by: WriterId
  /** When, in ms since the epoch. */
  readonly createdAt: number
}

// --- commands ---------------------------------------------------------------

/** Error codes the host may return. Kept here so both sides agree without I/O. */
export const ERR = {
  UNKNOWN_KIND: "unknown_kind",
  EMPTY_MESSAGE: "empty_message",
  /** pi refused the target: it is not in this conversation. */
  UNKNOWN_TARGET: "unknown_target",
  /** pi refused for a reason with no more specific code here. */
  REFUSED: "refused",
  /**
   * The root is no entry: a `reply` or `queue` has nothing to continue.
   * Only a `branch` starts a thread at it.
   */
  NO_ANCHOR: "no_anchor",
  /** A display name is empty or too long. */
  INVALID_NAME: "invalid_name",
  /**
   * A write in a task in the archive, or a move out of one: restore the task
   * first. The message names who moved it there.
   */
  TASK_ARCHIVED: "task_archived",
  /** Moving a task into the archive while an agent of its works or cards are queued. */
  TASK_BUSY: "task_busy",
  /** A workflow state the session's workflow does not hold. */
  UNKNOWN_STATE: "unknown_state",
  /** Removing a workflow state that still holds a task. */
  STATE_NOT_EMPTY: "state_not_empty",
  /** Moving or removing the archive. */
  STATE_ARCHIVE: "state_archive",
  /** A workflow state named with nothing but spaces. */
  EMPTY_NAME: "empty_name",
  /** Removing the only open workflow state: a new task needs one to land in. */
  LAST_STATE: "last_state",
  /** A lane pi holds an operation open on: after a crash, until it resumes. */
  BUSY: "busy",
  /** Landing a lane that has no copy of its own: a host without tools made it. */
  NOT_OWN_COPY: "not_own_copy",
  /** An offer action on a lane with no offer in your repo. */
  NO_OFFER: "no_offer",
  /** A `/package:name` command that names no command there is. */
  UNKNOWN_COMMAND: "unknown_command",
  /** A peer whose principal is not an email: nobody the host can name. */
  INVALID_IDENTITY: "invalid_identity",
  /** A message shows a `/blob/` image the host does not store. */
  IMAGE_MISSING: "image_missing",
  /** A picture pi cannot decode or fit within `PICTURE_MOST`. */
  PICTURE_UNREADABLE: "picture_unreadable",
  /** A title with a line break, or longer than `MAX_TITLE`. */
  INVALID_TITLE: "invalid_title",
  /** A new thread's lane id that names a lane pi already holds. */
  LANE_ID_IN_USE: "lane_id_in_use",
  /** A branch naming a thread that has started already. */
  THREAD_TAKEN: "thread_taken",
  /** A new task's id that names a task the session already holds. */
  TASK_ID_IN_USE: "task_id_in_use",
  /** A new root's id that names a root the session already holds. */
  ROOT_ID_IN_USE: "root_id_in_use",
  /** An offer accepted, or a publish, before accepted work is set up. */
  NOT_SET_UP: "not_set_up",
  /** Publishing in a repo with no publish bookmark. */
  NO_PUBLISH: "no_publish",
  /** Publishing while the publish bookmark has commits accepted work lacks. */
  NOT_FAST_FORWARD: "not_fast_forward",
  /** Publishing while the working copy has conflicts, or catching it up would make some. */
  YOURS_CONFLICT: "yours_conflict",
  /** An acceptance into a bookmark that is not one of the offer's destinations now. */
  BAD_DESTINATION: "bad_destination",
  /** A new thread's base that is not a WIP bookmark above accepted work. */
  BAD_BASE: "bad_base",
  /** Bringing a thread up to date with a WIP bookmark that is gone. */
  BASE_GONE: "base_gone",
  /** Catching up with the thread it branched from, for a thread that began at its base. */
  NO_PARENT: "no_parent",
  /** Catching up with the thread it branched from while that thread's agent runs. */
  PARENT_RUNNING: "parent_running",
  /**
   * An acceptance that now brings other work than the one it was shown (another
   * ledger), or now conflicts where it did not.
   */
  OFFER_CHANGED: "offer_changed",
  /** An answer to a lane's use of an ssh identity, from someone not its owner. */
  NOT_OWNER: "not_owner",
  /** An answer the lane's access does not take now: nothing waits, or it is already so. */
  NOTHING_TO_ANSWER: "nothing_to_answer",
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

/**
 * A command refused, and why. Planners return it, the codec decodes to it, and
 * the host answers it as its outcome unchanged.
 */
export interface Refusal {
  readonly kind: "refused"
  readonly code: ErrCode
  readonly message: string
}

export const refused = (code: ErrCode, message: string): Refusal => ({
  kind: "refused",
  code,
  message,
})

/** A namespace of the host's own records. pi's are `pi.`, and never the host's to write. */
export type HostNamespace = `pinetrie.${string}`
/** Which document a host record is written to: the session's, or a root's. */
export type Target =
  | { readonly kind: "session" }
  | { readonly kind: "root"; readonly root: RootId }

export const SESSION_TARGET: Target = { kind: "session" }

/**
 * One write to a pi value at its address, in its document, as the host decides
 * it and pi's session carries it out. Built by `setRecord` and `deleteRecord`
 * (`@pinetrie/rules`), which take the target from the record's home.
 */
export type ValueWrite =
  | {
      readonly kind: "set"
      readonly target: Target
      readonly namespace: HostNamespace
      readonly key: string
      readonly value: unknown
    }
  | {
      readonly kind: "delete"
      readonly target: Target
      readonly namespace: HostNamespace
      readonly key: string
    }

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
export type ChatMode = "reply" | "branch"

/**
 * Where a message goes. A send at a thread's `end` names the thread and the
 * entry its sender saw as its end; the host finds the end (`threadEnd`). A
 * `branch` names the new thread the sender's column minted, where it forks (an
 * entry, or null for a thread at the root), and the task its card goes in: a
 * new one the sender's tab minted for a new root, else the task its column is
 * on. So no send can land anywhere but a thread's end without starting a
 * thread, no thread's end ever gets two continuations, and no thread starts
 * without a place.
 */
export type ChatAt =
  | {
      readonly kind: "end"
      readonly thread: ThreadId
      readonly seen: EntryId
    }
  | {
      readonly kind: "branch"
      readonly thread: ThreadId
      readonly at: EntryId | null
      readonly task: TaskId
    }

/** A send's mode, from where it goes. */
export const modeOf = (at: ChatAt): ChatMode =>
  at.kind === "end" ? "reply" : "branch"

/**
 * How the host plans a message: a client's mode, or `queue`, for a queued card
 * it pops. The lane's queue has already decided that card's turn, so only a run
 * makes the lane busy, and a race does not count. A client never sends it: it
 * queues a card instead.
 */
export type PlanMode = ChatMode | "queue"

/**
 * Where the host sends a message: where a client's goes (`ChatAt`), or the
 * end of the thread whose queued card it pops.
 */
export type SendAt =
  | ChatAt
  | { readonly kind: "queue"; readonly thread: ThreadId }

/** How the host plans a send, from where it goes. */
export const planModeOf = (at: SendAt): PlanMode =>
  at.kind === "queue" ? "queue" : modeOf(at)

/**
 * How an opened thread starts. A branch at `at` in its root, its card just
 * after the thread `at` is in. A new tab's: a new root's first thread in a
 * new task, which lands in `state` (the first open state for null). A new
 * root's first thread in a task the session holds, its card just after
 * `after` (first for null; at the end when `after` has left the canvas).
 */
export type ThreadStart =
  | { readonly kind: "branch"; readonly at: EntryId }
  | { readonly kind: "new-task"; readonly state: WorkflowStateId | null }
  | { readonly kind: "new-root"; readonly after: CardId | null }

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule, so this type cannot express a
 * malformed command. What it then does is decided by `planChat` and the
 * other planners in `@pinetrie/rules`, over what the host gathers.
 */
export type Intent =
  /** A human message; `mentions` are parsed from `text` once, at the codec. */
  | {
      readonly kind: "chat"
      readonly text: string
      /**
       * The root it is written in: a new one the sender's tab minted for a
       * thread at the root.
       */
      readonly root: RootId
      readonly at: ChatAt
      /** A Start Agent column: with no mention, the agent is asked. */
      readonly asksAgent: boolean
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
       * null for the first open state. Read only when it starts one.
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
   * card there, carrying `command`, so the drain the queueing starts pops it
   * with its command.
   */
  | {
      readonly kind: "queue-card"
      readonly move: QueueMove
      readonly hold: QueueHoldChange
      /** The created card's command; null for a move of a card that exists. */
      readonly command: CardCommand | null
    }
  /** Take every message card queued on a thread back below the line. */
  | { readonly kind: "unqueue-all"; readonly lane: ThreadId }
  /**
   * Make a text card a thread: a new conversation root, `root`, its thread
   * `thread`, whose first message is the card's text, in a new task, `task`, in
   * `state`, or the first open state for null; the card goes to the trash, in
   * the history `here` names when it leaves no task.
   */
  | {
      readonly kind: "spin-off"
      readonly move: Move<Extract<PlaceKey, { readonly kind: "trash" }>>
      readonly root: RootId
      readonly thread: ThreadId
      readonly task: TaskId
      readonly state: WorkflowStateId | null
      /**
       * The task its sender will be on, which names the move's history for a
       * card from an inventory: the new task for a drop in the sidebar, else
       * the one they are on.
       */
      readonly here: TaskId | null
    }
  /**
   * Move a task on the board: from the state its sender saw it in, to `to`,
   * before `before` there, or at its end. Into the archive it archives the
   * task, and out of it restores the task.
   */
  | {
      readonly kind: "move-task"
      readonly task: TaskId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: TaskId | null
    }
  /** Change the session's workflow states. */
  | { readonly kind: "workflow"; readonly edit: WorkflowEdit }
  /**
   * Title a task or a note column, or clear its title with null: one gesture,
   * each title in its own record.
   */
  | {
      readonly kind: "mark"
      readonly of: MarkTarget
      readonly title: string | null
    }
  /** Ask a model for a task's title, from its first thread's messages. */
  | { readonly kind: "retitle"; readonly task: TaskId }
  /**
   * Act on a lane's offer in your repo. An acceptance names its destination
   * bookmark, null for the default, and what it was shown (`seen`); every other
   * action, null.
   */
  | {
      readonly kind: "offer"
      readonly lane: ThreadId
      readonly action: OfferAction
      readonly to: string | null
      readonly seen: OfferSeen | null
    }
  /** Set up accepted work, or publish it. */
  | { readonly kind: AcceptedAction }
  /**
   * Move cards, create one, or remove one: one move, or a keep's several,
   * accepted whole or refused. The host records it in a task's history of the
   * sender's moves (`historyOf`); `here`, the task its sender is on, is a
   * discard's from an inventory.
   */
  | {
      readonly kind: "move"
      readonly moves: readonly TypedMove[]
      readonly here: TaskId | null
    }
  /**
   * Open a thread before its first entry, as its column opens: its record, and
   * its card on `task`'s canvas, as `start` says.
   */
  | {
      readonly kind: "open-thread"
      readonly thread: ThreadId
      readonly root: RootId
      readonly task: TaskId
      readonly start: ThreadStart
    }
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
   * cutter, where `to` sends it, after discarding the card it replaces. One
   * step of the sender's history, in the task it lands in; `here`, the task its
   * sender is on, names a discard's from an inventory.
   */
  | {
      readonly kind: "paste"
      readonly paste: Paste
      readonly to: MoveTarget
      readonly replacing: Replacing | null
      readonly here: TaskId | null
    }
  /**
   * Move a queued or pinned card among its neighbours, recorded in its root's
   * history of the sender's moves.
   */
  | { readonly kind: "reorder"; readonly reorder: Reorder }
  /**
   * Draw a card on a canvas one column wide or two, from where its sender saw
   * it (`at`): a compare-and-set, as a reorder is, recorded in the task's
   * history of the sender's moves.
   */
  | {
      readonly kind: "card-width"
      readonly card: CardId
      readonly at: CanvasKey
      readonly width: CardWidth
    }
  /**
   * Undo or redo the sender's newest move in `task`, or, with none, in their
   * history outside any task.
   */
  | {
      readonly kind: "undo-move"
      readonly task: TaskId | null
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
 * What can be done with an offer: accept it into accepted work or a WIP, squash
 * a stack back to one revision, have the agent write its description again, or
 * rebuild it, discarding your edits. Splitting it is a card's command, `split`,
 * popped when the thread is free.
 */
export type OfferAction = "accept" | "squash" | "describe" | "refresh"
export const OFFER_ACTIONS: readonly OfferAction[] = [
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
export const ACCEPTED_ACTIONS: readonly AcceptedAction[] = ["setup", "publish"]

// --- the board --------------------------------------------------------------

/** A workflow state: a column of the board. */
export interface WorkflowState {
  readonly id: WorkflowStateId
  readonly name: string
}

/**
 * The session's workflow: a host-written `pinetrie.workflow` singleton. The
 * open states in board order, then the archive, which is always there and
 * always last: a root in it is archived.
 */
export interface Workflow {
  readonly open: readonly WorkflowState[]
  readonly archive: WorkflowState
}

/**
 * A change to the workflow. `state` names the state acted on (null to add
 * one); `name` is the new name (add, rename); `before` is where a moved or
 * added open state goes, null for after every open state.
 */
export interface WorkflowEdit {
  readonly action: WorkflowAction
  readonly state: WorkflowStateId | null
  readonly name: string
  readonly before: WorkflowStateId | null
}
export type WorkflowAction = "add" | "rename" | "move" | "remove"
export const WORKFLOW_ACTIONS: readonly WorkflowAction[] = [
  "add",
  "rename",
  "move",
  "remove",
]

/**
 * A task's place on the board: a host-written `pinetrie.board` value keyed by
 * its `TaskId`. A task has one, written as it starts and as it moves.
 */
export interface BoardPlace {
  readonly task: TaskId
  readonly state: WorkflowStateId
  /** Its order within the state: an order key. */
  readonly rank: string
  /** Who moved it there, and when, in ms since the epoch. */
  readonly by: WriterId
  readonly at: number
}

/**
 * A task in the archive, derived from its place and never stored: who
 * moved it there, and when. Its readers ask only whether a task is archived,
 * and by whom.
 */
export interface ArchivedTask {
  readonly task: TaskId
  readonly by: WriterId
  readonly at: number
}

// --- the directory of roots -------------------------------------------------

/**
 * A root as the sidebar, the board and your inbox see it,
 * without its document: a host-written `pinetrie.root` value in the session,
 * keyed by the root's id, refreshed whenever the root's document changes.
 */
export interface RootRecord {
  readonly root: RootId
  /** Its root entry, the tab's key; null before its first message. */
  readonly entry: EntryId | null
  /** Its first message, as the rail finds it (`RootSummary.first`). */
  readonly first: EntryId | null
  /** That message's first line: the label while it has no title. */
  readonly firstLine: string
  /** Its messages: the rail's rows. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId | null
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
  /**
   * Per thread, everyone who wrote a chat on its path from the root to its tip,
   * in order of first message: its followers.
   */
  readonly threads: Readonly<Record<ThreadId, readonly WriterId[]>>
  /**
   * Its chats that name someone (`@`), for the inbox to resolve, each with the
   * thread it is in, which the inbox opens it in.
   */
  readonly mentions: readonly {
    readonly id: EntryId
    readonly by: WriterId
    readonly text: string
    readonly thread: ThreadId
  }[]
  /** Every image it shows (`referencedBlobs`), for the image sweep. */
  readonly images: readonly Sha256[]
}

// --- marks ------------------------------------------------------------------

/**
 * A task's title: a host-written `pinetrie.mark` value in the session, keyed by
 * the task's id, so a task has at most one.
 */
export interface MarkRecord {
  readonly task: TaskId
  readonly title: string
  /** The person who set it, or the agent for a title it made unasked. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** What a title names: a task, or a note column. */
export type MarkTarget =
  | { readonly kind: "task"; readonly task: TaskId }
  | { readonly kind: "note-column"; readonly column: NoteColumnId }

/**
 * A note column's title: a host-written `pinetrie.note-column` value in the
 * session, keyed by the column's id, absent while untitled. Who made the column
 * is its card's owner, and when is in its id.
 */
export interface NoteColumnRecord {
  readonly column: NoteColumnId
  readonly title: string
  /** The person who set it. */
  readonly by: WriterId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

// --- stops ------------------------------------------------------------------

/**
 * Who stopped an ask's run, as a fact in its thread: queued as a fact card when
 * Stop is pressed, and appended as the run ends, so the agent's next run reads
 * it. pi's entries say a run was aborted, never by whom.
 */
export interface StopFact {
  readonly kind: "stopped"
  readonly lane: ThreadId
  /** The ask whose run was stopped: its prompt. */
  readonly prompt: EntryId
  readonly by: WriterId
  /** When Stop was pressed, in ms since the epoch. */
  readonly at: number
  /**
   * The message whose budget was spent, when it was the budget that stopped the
   * run, and `by` is whose message it was; absent for a Stop.
   */
  readonly budget?: EntryId
}

/**
 * Who joined or left a thread's members: a person dismissed an agent, or the
 * agent left. Read back by `threadMembers`.
 */
export type MemberFact =
  | {
      readonly kind: "dismissed"
      readonly lane: ThreadId
      readonly member: ThreadId
      readonly by: WriterId
    }
  | {
      readonly kind: "left"
      readonly lane: ThreadId
      readonly member: ThreadId
      /** The person behind the run that left (`promptAuthor`). */
      readonly by: WriterId
    }

/**
 * An ask another thread's agent did not answer: its run was stopped or failed.
 * In the thread that asked; `member` is the asked thread, `by` the person
 * behind the chain.
 */
export interface UnansweredFact {
  readonly kind: "unanswered"
  readonly lane: ThreadId
  readonly member: ThreadId
  readonly why: "stopped" | "failed"
  readonly by: WriterId
}

/** Where a thread is: `threadReach` (`@pinetrie/rules`) reads it. */
export type Reach =
  | { readonly kind: "open"; readonly task: TaskId }
  | {
      readonly kind: "archived"
      readonly task: TaskId
      readonly record: ArchivedTask
    }
  | { readonly kind: "held"; readonly by: WriterId }
  /** In the trash of `task`'s canvas, until it is restored or deleted. */
  | { readonly kind: "trashed"; readonly task: TaskId }
  | { readonly kind: "gone" }

/** A thread out of reach: its task archived, held in an inventory, trashed, or gone. */
export type Away = Exclude<Reach, { readonly kind: "open" }>

/**
 * An answer that could not be sent: the thread that asked went out of reach
 * while it was answered. In the answering thread; `to` is the thread that
 * asked, `why` where it is now.
 */
export interface UndeliveredFact {
  readonly kind: "undelivered"
  readonly lane: ThreadId
  readonly to: ThreadId
  readonly toName: string
  readonly why: Away
  readonly by: WriterId
}

/**
 * What the request after a round of answers told the people: a line for them,
 * in the thread whose message asked. `by` is whose it was.
 */
export interface RoundFact {
  readonly kind: "round"
  readonly lane: ThreadId
  readonly line: string
  readonly by: WriterId
}

/**
 * Agents spent a budget: its message's tokens ran out, in the thread whose
 * message set it. `by` is whose message it was.
 */
export interface BudgetSpentFact {
  readonly kind: "budget-spent"
  readonly lane: ThreadId
  readonly budget: EntryId
  readonly limit: number
  readonly by: WriterId
}

/**
 * A thread's queue held: a host-written `pinetrie.queue-hold` value in the
 * session, keyed by the lane. While it is there no message card is popped, only
 * facts, until someone releases it.
 */
export interface QueueHold {
  readonly lane: ThreadId
  readonly by: WriterId
  /** When it was held, in ms since the epoch. */
  readonly at: number
}

/** What a digest says. */
export interface DigestBody {
  /**
   * One line of at most `HEADLINE_WORDS` words (`@pinetrie/rules`'
   * `digest.ts`); null when the model found
   * nothing the reader does not see already.
   */
  readonly headline: string | null
  /** At most `MAX_POINTS` markdown lines, one point each; empty when `headline` is null. */
  readonly points: readonly string[]
}

/** An ask's digest: replaced whole on each write, so a value, not a text. */
export interface DigestRecord extends DigestBody {
  /** The ask's prompt: the digest's key. */
  readonly prompt: EntryId
  /** When it was written, in ms since the epoch. */
  readonly at: number
  /** Written after its run ended: kept, and never replaced by a live one. */
  readonly final: boolean
}

/** What a model says a run's end asks of the people in its thread. */
export type Said = "needsYou" | "worthARead" | "done"

/**
 * How a thread's last run ended: what happened, never what it asks of whom.
 * Each client decides that for its person (`levelOf`).
 */
export type Verdict =
  /** The run has stopped running, and the model has not answered yet. */
  | { readonly kind: "pending" }
  /** The model's answer; `reason` is null for `done`. */
  | {
      readonly kind: "said"
      readonly said: Said
      readonly reason: string | null
    }
  | { readonly kind: "failed"; readonly error: string }
  /** `by` is null for a stop made before stops were recorded. */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  /** The request failed, its answer was no verdict, or its host stopped. */
  | { readonly kind: "unclassified" }

/** A thread's last run's verdict: a session record keyed by its lane. */
export interface VerdictRecord {
  readonly lane: ThreadId
  /** The run's prompt. */
  readonly ask: EntryId
  /**
   * The run's last entry, from its asks (`AskIndex.last`), never the lane's
   * tip: a queued card popped at the run's end can move the tip before this
   * is read.
   */
  readonly end: EntryId
  readonly verdict: Verdict
}

/** A title's longest form, in UTF-16 code units. */
export const MAX_TITLE = 80

/** What a typed title asks for. */
export type TitleInput =
  | { readonly kind: "set"; readonly title: string }
  | { readonly kind: "clear" }
  | { readonly kind: "invalid" }

/**
 * A title as typed, trimmed: empty clears it; a line break, or more than
 * `MAX_TITLE`, is invalid. The codec and the page both decide by this, so
 * they accept the same titles.
 */
export function parseTitle(text: string): TitleInput {
  const title = text.trim()
  if (title === "") return { kind: "clear" }
  return /[\r\n]/.test(title) || title.length > MAX_TITLE
    ? { kind: "invalid" }
    : { kind: "set", title }
}

// --- where lanes work -------------------------------------------------------

/**
 * What stops an editor from opening, for jj and for a lane's shell: a shell
 * with no terminal would wait on one until its timeout. With these, a command
 * that wants one fails at once.
 */
export const NO_EDITOR = {
  JJ_EDITOR: "false",
  VISUAL: "false",
  EDITOR: "false",
} as const

/**
 * The product's name as a person reads it: lowercase, with a middle dot so it
 * reads as "pine". Code names say `pinetrie`.
 */
export const PRODUCT_NAME = "pine·trie"

/**
 * The user every host operation on your repo carries, so the evolog says which
 * commits the host made, and a race is repaired in your favour.
 */
export const HOST_OPERATOR = "pinetrie-host"

/**
 * Where a thread's lane starts and is brought up to date from: accepted work,
 * or a WIP bookmark you chose at its first message.
 */
export type ThreadBase =
  | { readonly kind: "accepted" }
  | { readonly kind: "wip"; readonly bookmark: string }

/** The thread a lane's copy was cloned from, by its lane and its name. */
export interface ParentThread {
  readonly kind: "parent"
  readonly lane: ThreadId
  readonly name: ThreadName
}

/**
 * Where a lane's working copy sits against its bookmark, read before a catch-up
 * merges: `@`'s parents, the lane's bookmark, and whether `@`'s one parent
 * descends from it (the agent's own commit).
 */
export interface CopyFacts {
  readonly parents: readonly CommitId[]
  readonly bookmark: CommitId | null
  readonly descends: boolean
}

declare const readyCopyBrand: unique symbol
/**
 * A copy found ready to take a merge (`planCopyReady`, its one maker): a
 * merge takes one, so none merges a copy nobody checked.
 */
export type ReadyCopy = CopyFacts & { readonly [readyCopyBrand]: true }

/** Why a copy cannot take a merge: off its line, or with no bookmark. */
export type CopyRefusal = "off-line" | "no-bookmark"

/**
 * Whether the lane's copy may take a merge: `@` on the thread's
 * own line, its one parent the lane's bookmark or the agent's own commit on
 * it (`planTurnCommit`'s rule). Otherwise the merge would land beside where
 * the agent works, as while a split's stack is the working copy. A repo
 * with no bookmark of the lane's has no line to be on, and is refused as
 * that, not as off it: a split is not the cause. Conflicts do not
 * refuse it: catching up is how a conflict the copy came with is settled.
 */
export const planCopyReady = (copy: CopyFacts): ReadyCopy | CopyRefusal => {
  if (copy.bookmark === null) return "no-bookmark"
  const [parent, ...more] = copy.parents
  return parent !== undefined &&
    more.length === 0 &&
    (parent === copy.bookmark || copy.descends)
    ? (copy as ReadyCopy)
    : "off-line"
}

/**
 * What a project's folder is to lanes: a jj workspace, whose repo is
 * accepted work, or any other folder (a git repo included).
 */
export type ProjectKind = "jj" | "folder"

/** What a catch-up merges from: the thread's base, or the thread it branched from. */
export type CatchUpFrom = ThreadBase | ParentThread

/** A lane's base, read from its history (`@pinetrie/lanes`' `laneBase`). */
export interface LaneBase {
  readonly base: ThreadBase
  /**
   * Where the lane's own work begins: accepted commit its base names, or the
   * WIP's copy; for a lane with no `Pinetrie-Base`, the newest accepted commit in
   * its history.
   */
  readonly start: CommitId
  /**
   * The commit of yours the lane holds whole since its base: the one its
   * `Pinetrie-Base` names (the WIP's, for a WIP, never the copy); for a lane
   * with none, `start`.
   */
  readonly source: CommitId
}

declare const commitIdBrand: unique symbol
/**
 * A jj commit id, full hex. A revision a lane builds on is immutable, so its
 * commit id never changes: never a change id, which names a commit's latest
 * rewrite.
 */
export type CommitId = string & { readonly [commitIdBrand]: true }
export const commitId = (id: string): CommitId => id as CommitId

/** Where every lane of its own sees its own directory. */
export const WORKSPACE_ROOT = "/workspace"
/** Where every lane of its own sees your working copy, read-only. */
export const HOST_WORKING_COPY = "/mnt/host-working-copy"

/** A project's config, at its repo's root. */
export const PROJECT_CONFIG_FILE = "pinetrie.json"

/**
 * A lane's home directory: on its disk, so what tools keep there (caches,
 * config) persists and travels with forks; under `.pinetrie-lane`, so it is
 * pine·trie's own and never committed.
 */
export const LANE_HOME_PATH = ".pinetrie-lane/home"
/** The lane's home, absolute. */
export const LANE_HOME = `${WORKSPACE_ROOT}/${LANE_HOME_PATH}`

/** The variable listing a lane's shared directories, absolute, one per line. */
export const SHARED_ENV = "PINETRIE_SHARED"

/**
 * The programs the lane runtime carries into every lane of its own, on its
 * `PATH` whatever the image. Each must be a static build in pinetrie's default
 * image, which the runtime is copied out of.
 */
export const RUNTIME_PROGRAMS = ["jj", "rg", "fd", "sd"] as const
export type RuntimeProgram = (typeof RUNTIME_PROGRAMS)[number]

/** `s` as one POSIX shell word. */
export const shellWord = (s: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Where every lane of its own sees host paths it is granted: `HOST_MOUNT` and
 * then the host path. One rule, so no granted path can shadow a directory of
 * the image's.
 */
export const HOST_MOUNT = "/mnt/host"

/** A host path, as a lane of its own sees it. */
export const hostPathInLane = (hostPath: string): string =>
  `${HOST_MOUNT}${hostPath}`

/** A command runs a pi skill or expands a pi prompt template. */
export type CommandKind = "skill" | "prompt"

/** A command as people see it: in the composer's completion and on a sent message. */
export interface CommandSummary {
  /** Qualified, without the slash: "duane:comments" or "duane:skill:plan". */
  readonly name: string
  readonly kind: CommandKind
  readonly description: string
  readonly argumentHint: string | null
}

/** What a command message stores: which file it ran, and what it expanded to. */
export interface CommandRef {
  readonly name: string
  readonly kind: CommandKind
  /** The skill's or template's file on the host: its identity. */
  readonly file: string
  /** sha256 of the file's text when it was sent. */
  readonly hash: string
  /** What the model reads in place of the typed text. */
  readonly expanded: string
}

/** The commands the host's pi loaded, as people see them. */
export interface CommandsRecord {
  readonly commands: readonly CommandSummary[]
}

declare const snapshotIdBrand: unique symbol
/**
 * A lane disk snapshot's id: the entry id of the revision record it belongs
 * to, or `"base"`. Its file is `.pinetrie/snapshots/<id>.img`. One snapshot
 * per record, so a turn retried after a crash writes the same file.
 */
export type SnapshotId = string & { readonly [snapshotIdBrand]: true }
export const snapshotId = (id: string): SnapshotId => id as SnapshotId
/** The project's disk at accepted work's commit, which root lanes fork from. */
export const BASE_SNAPSHOT = snapshotId("base")

/**
 * One path that differs between two snapshots of a disk, from the disk's
 * root. A renamed directory is its old path deleted and its new one added,
 * the directory alone: what is under it moved with it.
 */
export interface DiskChange {
  readonly path: string
  readonly change: "added" | "changed" | "deleted"
  /** What is at the path: what was, for a deletion; `other` when not known. */
  readonly kind: "file" | "dir" | "symlink" | "other"
}

/**
 * Paths on a lane's disk that pine·trie, the repos and the file system keep:
 * never classed, never a recipe's output, never deleted as stale. The lane's
 * home, under `.pinetrie-lane`, is classed all the same (`LANE_HOME_PATH`).
 */
export const DISK_OWN_ROOTS: readonly string[] = [
  ".pinetrie-lane",
  ".jj",
  ".git",
  "lost+found",
]

/** Whether `p`, from a disk's root, is `root` or under it, for any of `roots`. */
export const isUnderAny = (p: string, roots: readonly string[]): boolean =>
  roots.some(r => p === r || p.startsWith(`${r}/`))

/** A path inside a disk: relative, each segment a name, never `.` or `..`. */
export const isPathInside = (p: string): boolean =>
  p !== "" &&
  !p.startsWith("/") &&
  p.split("/").every(s => s !== "" && s !== "." && s !== "..")

declare const diskPathBrand: unique symbol
/**
 * A path checked to stay inside a disk (`isPathInside`), as a recipe's
 * outputs are: what pine·trie deletes on a lane's disk is one of these.
 */
export type DiskPath = string & { readonly [diskPathBrand]: true }
/** `p` as a `DiskPath`; null for a path that leaves the disk. */
export const diskPath = (p: string): DiskPath | null =>
  isPathInside(p) ? (p as DiskPath) : null

/** What differs between two snapshots of a disk, sorted by path. */
export interface DiskDiff {
  readonly changes: readonly DiskChange[]
}

/**
 * A lane's record: a host-written `pinetrie.lane` value keyed by the lane's
 * name, written once, when the lane is created. The setting never changes: a
 * lane's files would stop matching its conversation.
 */
export interface LaneRecord {
  readonly lane: ThreadId
  /** The root the lane works in. */
  readonly root: RootId
  /**
   * Whether it works in a copy of its own, in its container: false for a lane a
   * host without tools made.
   */
  readonly ownCopy: boolean
  readonly by: WriterId
  readonly createdAt: number
}

/** Some of a turn's paths: the first of them, and how many more. */
export interface ListedPaths {
  readonly paths: readonly string[]
  readonly more: number
}

/** How many paths of each class a turn's record lists. */
export const DISK_LISTED = 100

/**
 * What a turn did to its lane's disk, beyond its commit: its runs' records
 * and tool writes classed by `.gitignore`, and what its whole-disk diff
 * found that no tool call wrote. Paths are topmost: a directory stands for
 * what is under it.
 */
export interface TurnDisk {
  /** Derived roots its runs wrote. */
  readonly derived: ListedPaths
  /** Local paths it wrote: ignored, and not made from source. */
  readonly local: ListedPaths
  /** Directories its runs made from source that `.gitignore` does not ignore. */
  readonly unignored: readonly string[]
  /** Source files it wrote that its commit left out: jj's size limit, for one. */
  readonly leftovers: readonly string[]
  /** The shared files' versions it read and wrote (`SharedLineage`). */
  readonly shared: TurnShared
}

/**
 * The files at an entry: a host-written `pinetrie.revision` value keyed by the
 * entry's id. Every run's prompt has one, and so does every assistant message
 * of a lane of its own that made tool calls. So the nearest record above any
 * entry names its lane, its commit and its disk (`nearestRevision`).
 */
export interface RevisionRecord {
  readonly entry: EntryId
  readonly lane: ThreadId
  /** The turn's commit; null when nothing tracked changed, or the lane has no copy of its own. */
  readonly commit: CommitId | null
  /**
   * The lane's whole disk at this entry; null for a lane with no copy of its
   * own, and in records written before lane containers.
   */
  readonly snapshot: SnapshotId | null
  /**
   * The paths the turn's commit changed, from the repository's root; none for a
   * prompt's record or a turn with no commit.
   */
  readonly paths: readonly string[]
  /** The files conflicted in `commit`: what a branch from here starts with. */
  readonly conflicts: readonly string[]
  /**
   * What the turn did to its disk beyond its commit. Null for a prompt's
   * record, a lane with no copy of its own, an update, and records written
   * before.
   */
  readonly disk: TurnDisk | null
}

/**
 * What the host found where it runs: a host-written `pinetrie.project` value,
 * rewritten at every start, and only by a host with tools, whose every lane has
 * its own copy.
 */
export interface ProjectRecord {
  readonly root: string
  /**
   * Whom the host's user config names its owner (`owner`): who answers when
   * a lane asks for their ssh identity. Null with none.
   */
  readonly owner: WriterId | null
}

/**
 * A lane's offer: one revision, or a stack, in your repo, holding the lane's
 * work you do not have yet. A host-written `pinetrie.offer` value keyed by
 * lane: the page's cache, written from the repo after each of the host's steps
 * (`offerRecord`, `@pinetrie/rules`). The host never decides from it: it reads
 * the offer from your repo (`OfferInRepo`), so a record lost or stale changes
 * nothing. What accepting it would bring, each revision's description, files
 * and diffs, is not stored: the page reads it by commit when it asks
 * (`RevisionReview`).
 */
export interface OfferRecord {
  readonly lane: ThreadId
  /** Its revisions: 1 for a single offer, more for a stack. */
  readonly size: number
  /** The lane turned since the stack was made: it no longer holds all of it. */
  readonly stale: boolean
  /** None when accepted work already holds its work (`offerStatus`'s `held`). */
  readonly files: readonly string[]
  /** Files that conflict with your committed work. */
  readonly conflicts: readonly string[]
  /**
   * The files conflicted where it starts, read only when it conflicts: those of
   * `conflicts` among them came with the lane's copy (`conflictCause`).
   */
  readonly startConflicts: readonly string[]
  /** Files it touches that you are editing in `@`. */
  readonly yourEdits: readonly string[]
  /** An agent wrote its description; false while it carries the placeholder. */
  readonly described: boolean
  /** You edited it since the host last wrote it: the host leaves it alone. */
  readonly edited: boolean
  /** Its bookmark in your repo, as jjui shows it. */
  readonly bookmark: string
  /**
   * The change id its top became when you accepted it; null while it is open.
   */
  readonly acceptedAs: string | null
  /**
   * Each revision's commit as the host last read it, bottom first: what a
   * review may read. It follows a rebase jj made under the offer, and your
   * edits.
   */
  readonly commits: readonly CommitId[]
  /**
   * What it brings, as its top's message says (`offerLedger`): the lane tip it
   * holds and where it starts. An acceptance names it (`OfferSeen`). Null for
   * an offer whose message carries none, and for a record written before the
   * field, until the owner's first observation writes it again.
   */
  readonly ledger: OfferLedger | null
  readonly at: number
}

/**
 * Where an offer's conflict comes from (`conflictCause`): the lane's work
 * against its target, or the copy it was cloned with, every conflicted file
 * already conflicted where it starts.
 */
export type ConflictCause = "work" | "start"

/** How jj says a file changed in a revision. */
export type FileChange = "added" | "modified" | "removed" | "copied" | "renamed"

/** One file of one revision, as jj's diff stats read it. */
export interface ReviewFile {
  readonly path: string
  /** jj's display path: `{old => new}` for a rename or copy, else `path`. */
  readonly shown: string
  readonly change: FileChange
  /** Lines added and removed; 0 and 0 for a binary file or a pure rename. */
  readonly added: number
  readonly removed: number
}

/**
 * One revision of an offer, as its commit holds it. A commit id names its
 * content, so this never changes for a commit.
 */
export interface RevisionReview {
  /** Its description, the host's trailers included. */
  readonly description: string
  readonly files: readonly ReviewFile[]
  /**
   * What its change to `pinetrie.json` would let lanes do or share once
   * accepted; none when it leaves the file, or only narrows it.
   */
  readonly widenings: readonly ConfigWidening[]
}

/**
 * What a review reads: one revision, the diff from its parent to it, or a
 * range, the diff from one commit to another, such as an ask's work across its
 * turns' revisions. Commit ids name their content, so a review of either never
 * changes.
 */
export type DiffSpan =
  | { readonly kind: "revision"; readonly commit: CommitId }
  | {
      readonly kind: "range"
      readonly from: CommitId
      readonly to: CommitId
    }

/** A span as one string, for a key or a URL: `<commit>`, or `<from>..<to>`. */
export const spanKey = (s: DiffSpan): string =>
  s.kind === "revision" ? s.commit : `${s.from}..${s.to}`

/**
 * What a fork starts on: a commit a lane recorded (a branch below agent work),
 * accepted work's commit, or a copy of a WIP bookmark made on the accepted
 * commit under it, so the lane freezes nothing of yours.
 */
export type ForkStart =
  | { readonly kind: "commits"; readonly commits: readonly CommitId[] }
  | { readonly kind: "accepted"; readonly commit: CommitId }
  | {
      readonly kind: "wip"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** The accepted commit under the WIP: the copy's parent. */
      readonly under: CommitId
    }

/**
 * What bringing a thread up to date merges into its lane: accepted work's
 * commit, or a fresh copy of a WIP; or the newest commit of the thread it
 * branched from.
 */
export type BaseMerge =
  | {
      readonly kind: "accepted"
      readonly commit: CommitId
      /** The thread moves to accepted work: with nothing to merge, a commit still names it. */
      readonly mark: boolean
    }
  | {
      readonly kind: "wip"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** Accepted work commit under the WIP: where the commits that came in start. */
      readonly under: CommitId
      /**
       * The lane's previous copy (`LaneBase.start`): the new copy's parent,
       * so conflicts the lane already resolved do not come back.
       */
      readonly on: CommitId
    }
  | (ParentThread & {
      /** The parent's newest commit (`ParentNow.newest`). */
      readonly commit: CommitId
      /** The parent commit the lane last caught up with: where the commits that came in start. */
      readonly caughtUpWith: CommitId
    })

declare const threadNameBrand: unique symbol
/**
 * A thread's name as people say it: two words, `amber-fox`. Minted by
 * `@pinetrie/rules`' naming and its decoder; stored, never recomputed.
 */
export type ThreadName = string & { readonly [threadNameBrand]: true }

/** A lane's name: a host-written `pinetrie.name` value keyed by the lane. */
export interface NameRecord {
  readonly lane: ThreadId
  readonly name: ThreadName
  readonly at: number
}

/**
 * The image behind a thread's column header: a host-written `pinetrie.banner`
 * value keyed by the lane. The image is a blob; a replaced one is no longer
 * referenced, and the blob sweep deletes it.
 */
export interface BannerRecord {
  readonly lane: ThreadId
  readonly sha: Sha256
  readonly at: number
}

/** Where threads' icons come from: the user config's `icons.source`. */
export const ICON_SOURCES = ["built-in", "drawn", "none"] as const
export type IconSource = (typeof ICON_SOURCES)[number]

/**
 * The host's icon source, published for the page as the one
 * `pinetrie.icons` value: the page shows a built-in icon only under
 * `built-in`, so it never shows one before a drawn one arrives.
 */
export interface IconsRecord {
  readonly source: IconSource
}

/**
 * A lane's use of its owner's ssh identity: asked, and what the owner
 * answered. The host's to change: a request held while it is `waiting` is
 * released or refused as it changes.
 */
export type PersonalAccess =
  | {
      readonly kind: "waiting"
      /** The host it is for; null when the lane's session named none. */
      readonly host: string | null
      readonly since: number
    }
  | { readonly kind: "approved"; readonly by: WriterId; readonly at: number }
  | {
      readonly kind: "refused"
      readonly by: WriterId
      readonly at: number
      /** Approved, then taken back. */
      readonly revoked: boolean
    }
  /** Nobody answered in time, or the host stopped while it waited. */
  | {
      readonly kind: "unanswered"
      readonly host: string | null
      readonly at: number
    }

/**
 * What ssh identities a lane holds and has used: a host-written
 * `pinetrie.access` value keyed by lane, which the column's header shows.
 */
export interface AccessRecord {
  readonly lane: ThreadId
  /** Null until the lane first asks for its owner's identity. */
  readonly personal: PersonalAccess | null
  /** Service identities it has signed with, by name, in first-use order. */
  readonly services: readonly string[]
  /** Names the host connected for it, in first-use order. */
  readonly hosts: readonly string[]
}

/** What the owner can say to a lane's use of their ssh identity. */
export type AccessAnswer = "approve" | "refuse" | "revoke"

/**
 * Accepted work in your repo, as the host last read it: a host-written
 * `pinetrie.accepted` value, a cache the page reads. The repo is the truth; the
 * host rewrites this whenever your repo's operation head moves.
 */
export interface AcceptedRecord {
  /** Accepted work's bookmark, and the prefix that makes a bookmark a WIP. */
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  /** The bookmark publishing moves forward to accepted work. */
  readonly publish: string
  /** Accepted work's commit; null before it is set up. */
  readonly commit: CommitId | null
  /**
   * Your repo's `immutable_heads()` now (null: jj's builtin), and what
   * setting up accepted work writes. Equal once it is written.
   */
  readonly heads: { readonly current: string | null; readonly proposed: string }
  /**
   * Your repo's `revsets.log` now (null: jj's default), and what setting up
   * accepted work writes: the offers added, since an immutable head is out of
   * jj's default log.
   */
  readonly log: { readonly current: string | null; readonly proposed: string }
  /** The WIP bookmarks a thread may start from, newest first. */
  readonly wips: readonly {
    readonly bookmark: string
    readonly commit: CommitId
    /** Line commits it lacks: how far it is behind accepted work. */
    readonly behind: number
    /** Its commits not on accepted work: what lands with it. */
    readonly ahead: number
  }[]
  /**
   * The publish bookmark against accepted work: its commit (null when the repo
   * has none), accepted commits it lacks (`behind`: what publishing moves it
   * over) and its commits accepted work lacks (`ahead`: publishing is a
   * fast-forward only at 0). Both 0 before accepted work is set up.
   */
  readonly published: {
    readonly commit: CommitId | null
    readonly behind: number
    readonly ahead: number
  }
  /**
   * Your `@-` against accepted work: accepted commits it lacks (`behind`), and
   * your commits below `@` accepted work lacks (`ahead`, `::@- ~ ::<accepted>`:
   * what a publish accepts). `catchUp` is what catching the working copy up
   * would do: how many files change, those that conflict, and your other heads
   * that move with `@`; null when nothing is behind, or `@` shares no commit
   * with accepted work. `conflicts` are your conflicted commits above accepted
   * work, `@` included, and the conflicted files in `@`.
   */
  readonly yours: {
    readonly behind: number
    readonly ahead: number
    readonly catchUp: {
      readonly changes: number
      readonly conflicts: readonly string[]
      readonly heads: number
    } | null
    readonly conflicts: {
      readonly commits: number
      readonly files: readonly string[]
    }
  }
  /**
   * `publish.catchUp`: whether a publish catches the working copy up and
   * accepts your commits below `@` before moving the publish bookmark.
   */
  readonly publishCatchesUp: boolean
}

/**
 * A thread's base as its lane's history says it: a host-written `pinetrie.base`
 * value keyed by lane, a cache the page reads. `start` is the commit the lane's
 * newest `Pinetrie-Base` trailer names, or accepted commit it forked from when
 * it has none.
 */
export interface BaseRecord {
  readonly lane: ThreadId
  readonly base: ThreadBase
  readonly start: CommitId
  /** A WIP base: on accepted work now (landed), gone without landing, or neither. */
  readonly state: "ok" | "landed" | "gone"
  /**
   * What catching up would change, read at the lane's tip and the base's commit
   * then; null when the base had not moved, or jj could not say. A reader whose
   * base has moved since reads it as unknown.
   */
  readonly catchUp: CatchUpRead | null
  /**
   * Accepted-offer commits of this thread on accepted work, above its base,
   * that name no source (`untracedLanes`): nothing is offered until it catches
   * up past them.
   */
  readonly untraced: readonly CommitId[]
  /**
   * Whether the lane's work since its start changes any file: `unknown` for an
   * untraced start, or one jj could not diff. A thread is told its base has new
   * work only with `some`, and caught up quietly only with `none`.
   */
  readonly work: WorkChanges
}

/** What catching up would change in a lane (`catchUpFiles`), and what it was read at. */
export interface CatchUpRead {
  readonly tip: CommitId
  /** The base's commit: accepted work's, or the WIP's. */
  readonly to: CommitId
  readonly files: readonly string[]
}

/**
 * A seat the host has seen: its Kyneta peer, the Yjs `clientID` its operations
 * carry, and the person it is. A host-written `pinetrie.seat` value keyed by
 * the peer, so anyone can name who wrote in a text after the seat has gone.
 */
export interface SeatRecord {
  readonly peer: string
  readonly clientId: number
  readonly writer: WriterId
  /** When the host first saw it, which orders contributors. */
  readonly at: number
}

/** A writer's display name. */
export interface ParticipantRecord {
  readonly writer: WriterId
  readonly name: string
}

/** A person's picture: a blob, keyed by their writer. */
export interface PictureRecord {
  readonly writer: WriterId
  readonly sha256: Sha256
}

// --- obligation: collaborators and compelled responders ----------------------

/**
 * An `@` in a message. Mentioning the agent COMPELS it to reply. Mentioning a
 * person addresses them, and so leaves the agent out; nobody can make a human
 * answer. A person mention counts only if it names a participant (`address`).
 */
export type Mention =
  | { readonly kind: "agent"; readonly agent: AgentId }
  | { readonly kind: "person"; readonly name: string }

/**
 * Who must answer a message. Only an agent can be compelled, so this type has
 * no way to say "compel a person".
 */
export type Responder =
  | { readonly kind: "none" }
  | { readonly kind: "agent"; readonly agent: AgentId }

export const NOBODY: Responder = { kind: "none" }

/**
 * The characters of a mention's handle: any letter or digit, in any script,
 * and `_` or `-`. `parseMentions` and `handleOf` share it, so every name that
 * can be shown can be typed as a mention.
 */
const HANDLE_CHARS = "\\p{L}\\p{N}_\\-"

/** A mention's `@`: it starts a word, so an e-mail address holds none. */
const MENTION_AT = `(?<![${HANDLE_CHARS}@])@`

/**
 * `text` with its code blanked out, each character a space and each line break
 * kept: fenced blocks
 * (``` or ~~~, to their closing fence or the end) and inline code spans (a run of backticks to the next run as long). A four-space indented block is left as it is: it needs the block's context, which a line scan does not have.
 */
function withoutCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ")
  const fenced = text.replace(
    /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm,
    blank,
  )
  return fenced.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}

/** A mention in a text: its `@` at `start`, its handle running to `end`. */
interface MentionSpan {
  readonly start: number
  readonly end: number
  /** Empty for a bare `@`. */
  readonly handle: string
}

/**
 * Every `@` in `text` that starts a mention, with the handle after it, outside
 * code (`withoutCode`): a handle in a code span or a fenced block is text. A
 * handle starts a word, so an e-mail address holds none. The one reading of
 * mentions, for what is sent (`parseMentions`) and what is being typed
 * (`typedMention`) alike.
 */
function mentionSpans(text: string): readonly MentionSpan[] {
  const pattern = new RegExp(`${MENTION_AT}([${HANDLE_CHARS}]*)`, "gu")
  // `withoutCode` keeps every offset, so its indices are the text's.
  return [...withoutCode(text).matchAll(pattern)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
    handle: m[1] ?? "",
  }))
}

/**
 * Every `@handle` in `text`, in order, without repeats (`mentionSpans`).
 * `@agent` is the agent; any other handle is read as a person here, and
 * `address` finds whom it names.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  for (const { handle } of mentionSpans(text)) {
    if (handle === "" || seen.has(handle)) continue
    seen.add(handle)
    out.push(
      handle === THE_AGENT
        ? { kind: "agent", agent: THE_AGENT }
        : { kind: "person", name: handle },
    )
  }
  return out
}

/** A mention being typed: its `@` at `start`, its handle running to `end`. */
export interface TypedMention {
  readonly start: number
  readonly end: number
  /** What is typed of its handle before the caret; empty after a bare `@`. */
  readonly typed: string
}

/**
 * The mention the caret at `caret` is in (`mentionSpans`), null where it is
 * in none. Its handle runs on past the caret, so a choice replaces the whole
 * word.
 */
export function typedMention(text: string, caret: number): TypedMention | null {
  const span = mentionSpans(text).find(m => m.start < caret && caret <= m.end)
  return span === undefined
    ? null
    : {
        start: span.start,
        end: span.end,
        typed: span.handle.slice(0, caret - span.start - 1),
      }
}

/**
 * A display name as a mention must spell it: lower case, composed (NFC), handle
 * characters only. "Ada Lovelace" is `@adalovelace`, "O'Brien" is `@obrien`,
 * "José" is `@josé`, "日本" is `@日本`.
 */
export const handleOf = (name: string): string =>
  name
    .normalize("NFC")
    .toLowerCase()
    .replace(new RegExp(`[^${HANDLE_CHARS}]`, "gu"), "")

/** Who asked another thread's agent: a person, or a thread's agent. */
export type Asker =
  | { readonly kind: "person"; readonly writer: WriterId }
  | { readonly kind: "agent"; readonly thread: ThreadId }

/**
 * An ask relayed into another thread, the asked agent's prompt: where it was
 * asked, by whom, and what. `budget` is the person's message whose budget the
 * chain spends (its run spends from it only when an agent asked); `by` is the
 * person behind the chain, who a stop, a card or a run's author names.
 */
export interface RelayDetails {
  readonly from: ThreadId
  readonly fromName: string
  /** The chat, or the agent's message calling `ask`, in `from`. */
  readonly source: EntryId
  readonly asker: Asker
  readonly askerName: string
  readonly text: string
  readonly budget: EntryId
  readonly by: WriterId
}

/**
 * An asked agent's answer, in the thread that asked: its last message of the
 * run its relay started. `wakes` says whether it started a run of the asking
 * agent.
 */
export interface AnswerDetails {
  /** The answering thread. */
  readonly from: ThreadId
  readonly fromName: string
  /** The relay, in `from`, whose run this answers. */
  readonly relay: EntryId
  /** The asking thread's entry the relay came from (`RelayDetails.source`). */
  readonly source: EntryId
  readonly text: string
  readonly wakes: boolean
  readonly budget: EntryId
  readonly by: WriterId
}

/**
 * What an asked agent heard of the thread that asked: those entries' ids,
 * newest last. Their text is the heard entry's `content`.
 */
export interface HeardDetails {
  readonly from: ThreadId
  readonly fromName: string
  readonly entries: readonly EntryId[]
}

/**
 * Another thread's agent a mention may reach: a thread on the open task's
 * canvas other than the one written in, by its name. `member` says whether it
 * was invited into the thread written in already.
 */
export interface AgentCandidate {
  readonly thread: ThreadId
  readonly name: ThreadName
  readonly member: boolean
}

/** Who a message is for. */
export interface Recipients {
  /** This thread's own agent, if it must answer: a run. */
  readonly compels: Responder
  /** Participants the message names, by display name. Never compelled. */
  readonly people: readonly string[]
  /** Members, other threads' agents, that it asks: each runs. */
  readonly asks: readonly ThreadId[]
  /** Other threads' agents it invites: they become members, asked or not. */
  readonly invites: readonly ThreadId[]
}

/** Whom a handle in a mention names. */
export type MentionTarget =
  | { readonly kind: "agent" }
  | { readonly kind: "thread"; readonly agent: AgentCandidate }
  | { readonly kind: "person"; readonly name: string }

/**
 * Every handle a mention can name, and whom: `@agent`, this thread's agent;
 * each candidate agent by its thread's name; each participant by their
 * name's handle. A handle names one target: a thread's agent before a person,
 * and of two people with one handle, the later in `participants`. In the
 * order first named: the agent, the threads, the people. `address` resolves
 * by it and the composer offers it, so it offers only what a send would
 * reach.
 */
export function mentionTargets(
  participants: readonly string[],
  agents: readonly AgentCandidate[],
): ReadonlyMap<string, MentionTarget> {
  const targets = new Map<string, MentionTarget>([
    [THE_AGENT, { kind: "agent" }],
  ])
  for (const agent of agents)
    targets.set(handleOf(agent.name), { kind: "thread", agent })
  for (const name of participants) {
    const handle = handleOf(name)
    if (targets.get(handle)?.kind !== "thread")
      targets.set(handle, { kind: "person", name })
  }
  return targets
}

/**
 * Who a message is for, each handle resolved by `mentionTargets`: another
 * thread's agent, before any person: a member is asked, any other invited. `@agent`
 * compels this thread's agent. Otherwise a message naming participants or
 * asking members is for them, and the agent is left out; an invite alone leaves
 * the message where it would have gone. Otherwise the thread decides: the agent
 * where it is the default (a thread with a lane, or a Start Agent column),
 * nobody where it is not. A message that then compels nobody, names no one and
 * asks no member asks the agents it invites, since nobody else would answer.
 *
 * A handle that names no participant and no candidate is ignored, so
 * `@types/node` in agent work still asks the agent. The composer and the host
 * both call it.
 */
export function address(input: {
  readonly mentions: readonly Mention[]
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  /** Other threads' agents on open tasks' canvases. */
  readonly agents: readonly AgentCandidate[]
  readonly agentByDefault: boolean
}): Recipients {
  const targets = mentionTargets(input.participants, input.agents)
  const people: string[] = []
  const asks: ThreadId[] = []
  const invites: ThreadId[] = []
  for (const m of input.mentions) {
    // Only `@agent` as typed names the agent (`parseMentions`).
    if (m.kind !== "person") continue
    const target = targets.get(handleOf(m.name))
    if (target?.kind === "thread") {
      const { member, thread } = target.agent
      const into = member ? asks : invites
      if (!into.includes(thread)) into.push(thread)
    } else if (target?.kind === "person") people.push(target.name)
  }
  const agent = input.mentions.find(m => m.kind === "agent")
  const compels: Responder =
    agent !== undefined
      ? { kind: "agent", agent: agent.agent }
      : people.length > 0 || asks.length > 0 || !input.agentByDefault
        ? NOBODY
        : { kind: "agent", agent: THE_AGENT }
  const nobodyElse =
    compels.kind === "none" && people.length === 0 && asks.length === 0
  return nobodyElse
    ? { compels, people, asks: invites, invites }
    : { compels, people, asks, invites }
}

/** A display name's longest form, in UTF-16 code units. */
export const MAX_NAME_LENGTH = 40

/**
 * A display name as typed -> the stored one, or undefined if unusable: empty,
 * too long, or one no mention could reach (no letter or digit, spelled
 * `@agent`, which is always the agent, or a thread's name, which is always that
 * thread's agent).
 */
export function normalizeName(name: string): string | undefined {
  const n = name.trim()
  const handle = handleOf(n)
  return n.length === 0 ||
    n.length > MAX_NAME_LENGTH ||
    handle === "" ||
    handle === THE_AGENT ||
    isThreadNameHandle(handle)
    ? undefined
    : n
}

// --- wire hygiene -----------------------------------------------------------

/**
 * The paths at which a `seq` key appears, so a test can assert none do.
 *
 * It matters for stored entries: the doc types them
 * `Schema.record(Schema.any())`, so nothing strips a stray key, and writing
 * `{ ...entry, seq: 99 }` fails the e2e stored-seq check. Line messages drop
 * one at the boundary: `packages/protocol/line.ts` declares Command and Reply
 * as `Schema.struct({...})`, and Kyneta encodes only declared fields, so the
 * e2e wire-seq check catches only the struct itself growing a `seq`. A brand
 * cannot do this: a branded number drops into any `number` field.
 */
export function findSeqKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = []
  if (value === null || typeof value !== "object") return hits
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      hits.push(...findSeqKeys(v, `${path}[${i}]`))
    })
    return hits
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "seq") hits.push(`${path}.${k}`)
    hits.push(...findSeqKeys(v, `${path}.${k}`))
  }
  return hits
}

// ── arrival ordering ────────────────────────────────────────────────────────

export interface EntryOrdering {
  /** Ids in the order they should receive their arrival seq. */
  readonly ordered: readonly string[]
  /**
   * Candidates on a parent cycle, or below one. A parent outside the batch
   * never blocks a candidate, whether or not it exists. Returned rather than
   * thrown, so the caller decides what a cycle means.
   */
  readonly unresolved: readonly string[]
}

/**
 * Order a batch of newly-arrived entries: parents before children, with the
 * smallest id winning any tie.
 *
 * This is the derivation behind the arrival seq, and it is pure so that its
 * claim can be tested rather than asserted: the result must not depend on the
 * order the candidates arrive in. Two replicas seeing the same delta in
 * different orders must assign the same sequence, or stable cursors silently
 * skip entries.
 *
 * A candidate is ready at once when `parentOf` returns `null` or `undefined`,
 * or a parent that is not itself a candidate.
 */
export function orderNewEntries(
  candidates: Iterable<string>,
  parentOf: (id: string) => string | null | undefined,
): EntryOrdering {
  const pending = new Set(candidates)
  const children = new Map<string, string[]>()
  const queue: string[] = []

  for (const id of pending) {
    const parent = parentOf(id)
    if (parent === null || parent === undefined || !pending.has(parent)) {
      queue.push(id)
      continue
    }
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [id])
    else siblings.push(id)
  }

  // Kahn, popping the smallest available id each round. Sorting the frontier
  // — not the input — is what makes the result permutation-invariant.
  const ordered: string[] = []
  while (queue.length > 0) {
    queue.sort()
    const id = queue.shift()
    if (id === undefined || !pending.has(id)) continue
    pending.delete(id)
    ordered.push(id)
    for (const child of children.get(id) ?? []) queue.push(child)
  }

  return { ordered, unresolved: [...pending] }
}

// ── the tree ──────────────────────────────────────────────────────────────

export * from "./address.ts"
export * from "./agents.ts"
export * from "./asks.ts"
export * from "./cards.ts"
export * from "./edits.ts"
export * from "./errors.ts"
export * from "./grid.ts"
export * from "./ids.ts"
export * from "./images.ts"
export * from "./kinds.ts"
export * from "./live.ts"
export * from "./offers.ts"
export * from "./paste.ts"
export * from "./paths.ts"
export * from "./places.ts"
export * from "./roots.ts"
export * from "./runs.ts"
export * from "./thread-names.ts"
export * from "./tools.ts"
export * from "./trailers.ts"
export * from "./tree.ts"
export * from "./work.ts"
