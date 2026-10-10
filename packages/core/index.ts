// core — PURE. No I/O. Imports nothing but its own modules. Property-testable.
//
// FC/IS (gather -> plan -> execute): everything here is `plan`. A decision is a
// VALUE; the shell in host/ performs it. This mirrors pi's own lane loop
// (pi-agent-core/dist/harness/runtime/lane.js:200):
//
//     const decision = await plan(this.state, mutator);
//     ... const commit = await mutator.commit(decision.writes, context);
//     this.state = decision.next;
//
// Nothing in this file may import pi, Kyneta, or a Node builtin.
//
// What belongs here, as `@pinetrie/rules` and `@pinetrie/repo` state it too: core holds the vocabulary (ids, intents, every record's type)
// and the reads of the tree. A format or type that `lanes` or `repo` must
// read, write or name lives in core too, since neither can declare
// `@pinetrie/rules`. What a stored shape says, and how the host changes it, is
// `@pinetrie/rules`', whoever reads it. Core also holds the few pure helpers
// several packages share (`paths.ts`, `errorText`), since every package that
// uses one already depends on core.

import type { Address } from "./address.ts"
import type { Sha256 } from "./images.ts"
import { KINDS } from "./kinds.ts"
import type { OfferLedger, OfferSeen, WorkChanges } from "./offers.ts"
import type {
  CanvasKey,
  CardCommand,
  CardWidth,
  IdOf,
  Move,
  MoveDirection,
  MoveOf,
  PlaceKey,
  QueueHoldChange,
  QueueMove,
  Reorder,
  SentCard,
  TypedMove,
} from "./places.ts"
import { isThreadNameHandle } from "./thread-names.ts"

// --- branded identifiers ----------------------------------------------------
//
// Several ADRs are constraints a type system can hold. Branding them moves the
// check from a runtime assertion in e2e/ to a compile error at the call site.
//
// A brand prevents MIX-UPS where a value is created and passed around. It does
// nothing about serialization, which is why a `LocalSeq` brand was deleted:
// its risk was a seq reaching the wire, and a branded number drops into any
// `number` field. These brands guard against swapped arguments, which is what
// brands are for.

declare const writerIdBrand: unique symbol
/**
 * A person, as the transport identifies them, never as a message claims: the
 * principal their connection named, which is their email (ADR-0037).
 * Authorship is recorded in each message by this id; people own no lanes
 * (ADR-0120).
 */
export type WriterId = string & { readonly [writerIdBrand]: true }

/** The only way to make a `WriterId`: from a person's email. */
export function writerId(email: string): WriterId {
  if (typeof email !== "string" || email.length === 0) {
    throw new Error("writerId: email must be a non-empty string")
  }
  if (email.includes("\u0000")) {
    throw new Error("writerId: email must not contain \\u0000")
  }
  return `w-${email}` as WriterId
}

/**
 * An email as typed -> the stored one, or undefined if it is not one: trimmed
 * and lower-cased, with one `@`, a letter or digit before it (so the part
 * before it can label and be mentioned), and a dotted domain after it. No
 * whitespace, and no `:`, since presence keys split on `:` (`seatKey`).
 * Unverified: it names who a peer says it is.
 */
export function normalizeEmail(text: string): string | undefined {
  const email = text.trim().toLowerCase()
  const at = email.indexOf("@")
  if (at <= 0 || at !== email.lastIndexOf("@")) return undefined
  if (/[\s:]/u.test(email) || email.includes("\u0000")) return undefined
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.indexOf(".")
  return /[\p{L}\p{N}]/u.test(local) && dot > 0 && dot < domain.length - 1
    ? email
    : undefined
}

/**
 * The writer a peer's principal names, or undefined for a principal that is
 * not an email: the host refuses such a peer's commands.
 */
export function writerOfPrincipal(
  principal: string | undefined,
): WriterId | undefined {
  const email = principal === undefined ? undefined : normalizeEmail(principal)
  return email === undefined ? undefined : writerId(email)
}

/** The part of a writer's email before the `@`: an unnamed writer's label. */
export const emailLocalPart = (writer: WriterId): string => {
  const email = writer.slice(2)
  const at = email.indexOf("@")
  return at < 0 ? email : email.slice(0, at)
}

declare const threadIdBrand: unique symbol
/**
 * A thread's id (ADR-0117): `t-` and a uuidv7, minted by the column that opens
 * the thread, before anything is written (ADR-0057). It also names the
 * thread's lane, when it has one (ADR-0120): a lane has no id of its own, so
 * no lane can be named by anything but a thread. `newThreadId()` mints one
 * (`@pinetrie/session`), `parseNewThread()` checks one a client sends, and
 * every reader of a stored one checks it with `isThreadId()`, so no writer's
 * id or `"main"` is one. `threadIdFor()` is for fixtures and parsers alone:
 * Biome refuses its import elsewhere.
 */
export type ThreadId = string & { readonly [threadIdBrand]: true }

const THREAD_PREFIX = "t-"

/** A thread's id from the text after its prefix. */
export const threadIdFor = (id: string): ThreadId =>
  `${THREAD_PREFIX}${id}` as ThreadId

/**
 * A thread's id as a regular expression's source: the prefix and at least
 * one character more. `@pinetrie/rules`' `ThreadIdSchema` checks stored ids
 * with it, so a schema and `isThreadId` cannot disagree.
 */
export const THREAD_PATTERN = `^${THREAD_PREFIX}[\\s\\S]`

const THREAD_RE = new RegExp(THREAD_PATTERN)

/**
 * Whether text names a thread: the check wherever a thread's id, or a lane
 * named by one, is read, in the codec, the schema's readers,
 * `@pinetrie/rules`' decoders and the pi adapter.
 */
export const isThreadId = (s: string): s is ThreadId => THREAD_RE.test(s)

const NEW_THREAD =
  /^t-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * A new thread's id as a client makes it, `t-` and a lowercase uuidv7;
 * undefined for anything else. Stricter than `isThreadId`: a lane's
 * container and volume are named after its thread's id (ADR-0057).
 */
export const parseNewThread = (s: string): ThreadId | undefined =>
  NEW_THREAD.test(s) ? (s as ThreadId) : undefined

/**
 * A thread as the host records it, keyed by its id in the session
 * (`pinetrie.thread`, ADR-0117), written with its first message. Its first
 * entry and its end are the tree's: every entry names its thread
 * (`EntryLike.thread`, ADR-0125).
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
 * How a thread began (ADR-0117): started by its first message, a branch's
 * or a new root's; or a copy of `source` at `fork`, its source's end as its
 * copier saw it, which its first send branches at and its fork row names.
 */
export type ThreadOrigin =
  | { readonly kind: "started" }
  | {
      readonly kind: "copy"
      readonly source: ThreadId
      readonly fork: EntryId
    }

/** A thread started by its first message. */
export const STARTED: ThreadOrigin = { kind: "started" }

declare const taskIdBrand: unique symbol
/**
 * A task's id (ADR-0116): `k-` and a uuidv7, minted by the tab that opens
 * the task, as it mints a `RootId`. A task is the board's card: its place,
 * its title, the sidebar and the layout are keyed by it. What it holds is in
 * the places document, never in its record.
 */
export type TaskId = string & { readonly [taskIdBrand]: true }

const TASK_PREFIX = "k-"
const NEW_TASK =
  /^k-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A task's id from the text after its prefix: for fixtures and parsers. */
export const taskIdFor = (id: string): TaskId => `${TASK_PREFIX}${id}` as TaskId

/** The pattern a task's id matches (`isTaskId`), for a stored schema. */
export const TASK_PATTERN = `^${TASK_PREFIX}[\\s\\S]`

/** Whether text names a task: the check wherever a task's id is read. */
export const isTaskId = (s: string): s is TaskId =>
  s.startsWith(TASK_PREFIX) && s.length > TASK_PREFIX.length

/** A new task's id as a client makes it, `k-` and a lowercase uuidv7; undefined for anything else. */
export const parseNewTask = (s: string): TaskId | undefined =>
  NEW_TASK.test(s) ? (s as TaskId) : undefined

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

declare const rootIdBrand: unique symbol
/**
 * A root's document's id (ADR-0063): `r-` and a uuidv7, minted by the tab
 * whose first message starts the root, as a column mints its lane's id
 * (ADR-0057). Not the root entry's id: a lane can exist in a root before pi
 * writes its first entry. The directory (`ROOT`) maps one to the other.
 */
export type RootId = string & { readonly [rootIdBrand]: true }

const ROOT_PREFIX = "r-"
const NEW_ROOT =
  /^r-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A new root's id, from a fresh uuidv7. */
export const rootIdFor = (uuid: string): RootId =>
  `${ROOT_PREFIX}${uuid}` as RootId

/** Whether text names a root's document: the check wherever a root id is read. */
export const isRootId = (s: string): s is RootId =>
  s.startsWith(ROOT_PREFIX) && s.length > ROOT_PREFIX.length

/** A new root's id as a client makes it, `r-` and a lowercase uuidv7; undefined for anything else. */
export const parseNewRoot = (s: string): RootId | undefined =>
  NEW_ROOT.test(s) ? (s as RootId) : undefined

declare const workflowStateIdBrand: unique symbol
/**
 * A workflow state's id (ADR-0122): `w-` and an id the host mints as the
 * state is added. A state is named apart from its id, so a rename keeps
 * every root's place.
 */
export type WorkflowStateId = string & { readonly [workflowStateIdBrand]: true }

const STATE_PREFIX = "w-"

/** A new workflow state's id, from a fresh id. */
export const workflowStateIdFor = (id: string): WorkflowStateId =>
  `${STATE_PREFIX}${id}` as WorkflowStateId

/** Whether text names a workflow state: the check wherever one is read. */
export const isWorkflowStateId = (s: string): s is WorkflowStateId =>
  s.startsWith(STATE_PREFIX) && s.length > STATE_PREFIX.length

const ROOT_DOC_PREFIX = "root:"

/** The id of a root's document, which holds its pi storage (ADR-0063). */
export const rootDocId = (root: RootId): string => `${ROOT_DOC_PREFIX}${root}`

/** A document id -> the root it is, or undefined for any other document. */
export function rootOfDocId(docId: string): RootId | undefined {
  if (!docId.startsWith(ROOT_DOC_PREFIX)) return undefined
  const root = docId.slice(ROOT_DOC_PREFIX.length)
  return isRootId(root) ? root : undefined
}

export const MOVES_DOC_PREFIX = "moves:"

/**
 * The host's undo stack of `writer`'s moves in `task` (ADR-0066, ADR-0116):
 * only the host holds it.
 */
export const movesDocId = (writer: WriterId, task: TaskId): string =>
  `${MOVES_DOC_PREFIX}${writer}:${task}`

/**
 * A document id -> the writer and task whose moves' stack it is, or
 * undefined for any other document: one keyed by a root, from before tasks,
 * among them. A task's id holds no `:`.
 */
export function movesOfDocId(
  docId: string,
): { readonly writer: WriterId; readonly task: TaskId } | undefined {
  if (!docId.startsWith(MOVES_DOC_PREFIX)) return undefined
  const rest = docId.slice(MOVES_DOC_PREFIX.length)
  const cut = rest.lastIndexOf(":")
  if (cut <= 0) return undefined
  const task = rest.slice(cut + 1)
  return isTaskId(task)
    ? { writer: rest.slice(0, cut) as WriterId, task }
    : undefined
}

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Positions take an entry id; `activeRuns` holds run ids. Passing
 * one where the other belongs would otherwise compile, run, and fail
 * silently. Mint them only where they enter: the protocol codec, an
 * address's parser (`parseAddress`), the reads,
 * the schema's readers, `@pinetrie/rules`' decoders, the pi adapter, the client's
 * stored forms, and the host's id generator. `biome.json` refuses an
 * `entryId` import in core, the client and the host, and a `runId` import in
 * core and the client (S95).
 */
export type EntryId = string & { readonly [entryIdBrand]: true }
export type RunId = string & { readonly [runIdBrand]: true }
export const entryId = (id: string): EntryId => id as EntryId
export const runId = (id: string): RunId => id as RunId
declare const textCardIdBrand: unique symbol
/**
 * A text card's id, a bare uuidv7: the key of its record and the name of its
 * text's document (ADR-0048).
 */
export type TextCardId = string & { readonly [textCardIdBrand]: true }
export const textCardId = (id: string): TextCardId => id as TextCardId

declare const noteColumnIdBrand: unique symbol
/**
 * A note column's id (ADR-0116): `n-` and a uuidv7, minted by the page that
 * makes the column (`newNoteColumnId`, `@pinetrie/session`) or by the host
 * that makes one for a note with nowhere to go (`nearestNoteColumn`).
 */
export type NoteColumnId = string & { readonly [noteColumnIdBrand]: true }

/** Whether text names a note column: the check wherever one is read. */
export const isNoteColumnId = (s: string): s is NoteColumnId =>
  s.startsWith(KINDS["note-column"].prefix) &&
  s.length > KINDS["note-column"].prefix.length
declare const mediaIdBrand: unique symbol
/** A media card's id (ADR-0116): `m-` and a uuidv7. */
export type MediaId = string & { readonly [mediaIdBrand]: true }
declare const fileCardIdBrand: unique symbol
/** A file card's id (ADR-0118): `f-` and a uuidv7. */
export type FileCardId = string & { readonly [fileCardIdBrand]: true }
declare const factCardIdBrand: unique symbol
/**
 * A fact card's id (ADR-0126): `x-` and a uuidv7, minted by the host as it
 * queues the fact (`f-` is a file card's).
 */
export type FactCardId = string & { readonly [factCardIdBrand]: true }

declare const referenceCardIdBrand: unique symbol
/**
 * A reference card's id (ADR-0126): `q-` and a uuidv7, minted by the page
 * that takes it (`a-` is an ask's, `r-` a root's).
 */
export type ReferenceCardId = string & {
  readonly [referenceCardIdBrand]: true
}

declare const askCardIdBrand: unique symbol
/**
 * An ask card's id (ADR-0128): `a-` and a uuidv7, minted by the host as it
 * queues an ask for a busy agent.
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
  | NoteColumnId
  | FactCardId
  | ReferenceCardId
  | AskCardId
  | MediaId
  | FileCardId

/** What a card is, from its id (`KINDS`). */
export type CardKind =
  | "text"
  | "thread"
  | "note-column"
  | "fact"
  | "reference"
  | "ask"
  | "media"
  | "file"

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

/** Whether a card's id is a reference's (ADR-0126). */
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
 * that is none. A text card's is a bare lowercase uuidv7; a note column's,
 * a fact's, a reference's, an ask's, a media card's and a file card's are
 * their prefix and one. A
 * thread's is any id `isThreadId` takes, as everywhere a thread is read, so
 * a thread the store names is never dropped for its id's shape. The one way
 * text becomes a `CardId` outside a minter.
 */
export function parseCardId(id: string): CardId | undefined {
  if (isThreadId(id)) return id
  if (TEXT_CARD_RE.test(id)) return id as TextCardId
  return PREFIXED_CARD_RE.test(id) ? (id as CardId) : undefined
}

/** A text card's id as it comes in (`parseCardId`); undefined for any other. */
export const parseTextCardId = (id: string): TextCardId | undefined =>
  TEXT_CARD_RE.test(id) ? (id as TextCardId) : undefined

declare const agentIdBrand: unique symbol
/**
 * The agent a message compels in its own thread: the host has one, `@agent`.
 * Other threads' agents are named by their threads (`Recipients.asks`, ADR-0128).
 */
export type AgentId = string & { readonly [agentIdBrand]: true }
/** The host's agent, addressed as `@agent`. */
export const THE_AGENT = "agent" as AgentId

// --- positions --------------------------------------------------------------

/**
 * A point in the tree: the root, or a specific entry.
 *
 * pi's API spells this `string | null`, and the wire spells it `""`. Both are
 * converted to a `Position` at the edge they arrive from, so decision logic
 * never has to guess whether `null` means "the root" or "absent". Only a
 * `branch` starts a thread at the root.
 */
export type Position =
  | { readonly kind: "root" }
  | { readonly kind: "entry"; readonly id: EntryId }

export const ROOT: Position = { kind: "root" }
export const atEntry = (id: EntryId): Position => ({ kind: "entry", id })

/**
 * A position in a given root (ADR-0063): what a command or a card's place
 * carries where it points into the tree, so the host knows the document
 * without looking the entry up.
 */
export interface Spot {
  readonly root: RootId
  readonly at: Position
}
export const samePosition = (a: Position, b: Position): boolean =>
  a.kind === "root" ? b.kind === "root" : b.kind === "entry" && a.id === b.id

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
   * A write in a task in the archive, or a move out of one (ADR-0029,
   * ADR-0116): restore the task first. The message names who moved it there.
   */
  TASK_ARCHIVED: "task_archived",
  /** Moving a task into the archive while an agent of its works or cards are queued. */
  TASK_BUSY: "task_busy",
  /**
   * Moving a task from a state it has left (ADR-0122). The message names who
   * moved it, and where.
   */
  TASK_MOVED: "task_moved",
  /** A workflow state the session's workflow does not hold (ADR-0122). */
  UNKNOWN_STATE: "unknown_state",
  /** Removing a workflow state that still holds a task (ADR-0122). */
  STATE_NOT_EMPTY: "state_not_empty",
  /** Moving or removing the archive (ADR-0122). */
  STATE_ARCHIVE: "state_archive",
  /** A workflow state named with nothing but spaces (ADR-0122). */
  EMPTY_NAME: "empty_name",
  /** Removing the only open workflow state: a new task needs one to land in. */
  LAST_STATE: "last_state",
  /** A lane pi holds an operation open on: after a crash, until it resumes. */
  BUSY: "busy",
  /** Landing a lane that has no copy of its own: a host without tools made it. */
  NOT_OWN_COPY: "not_own_copy",
  /** An offer action on a lane with no offer in your repo (ADR-0105). */
  NO_OFFER: "no_offer",
  /** A `/package:name` command that names no command there is (ADR-0036). */
  UNKNOWN_COMMAND: "unknown_command",
  /** A peer whose principal is not an email: nobody the host can name. */
  INVALID_IDENTITY: "invalid_identity",
  /** A message shows a `/blob/` image the host does not store (ADR-0042). */
  IMAGE_MISSING: "image_missing",
  /** A picture pi cannot decode or fit within `PICTURE_MOST` (ADR-0098). */
  PICTURE_UNREADABLE: "picture_unreadable",
  /** A title with a line break, or longer than `MAX_TITLE` (ADR-0045). */
  INVALID_TITLE: "invalid_title",
  /** A new thread's lane id that names a lane pi already holds (ADR-0057). */
  LANE_ID_IN_USE: "lane_id_in_use",
  /** A branch naming a thread that has started already (ADR-0117). */
  THREAD_TAKEN: "thread_taken",
  /** A new task's id that names a task the session already holds (ADR-0116). */
  TASK_ID_IN_USE: "task_id_in_use",
  /** A new root's id that names a root the session already holds (ADR-0063). */
  ROOT_ID_IN_USE: "root_id_in_use",
  /** An offer accepted, or a publish, before accepted work is set up (ADR-0104). */
  NOT_SET_UP: "not_set_up",
  /** Publishing in a repo with no publish bookmark (ADR-0076). */
  NO_PUBLISH: "no_publish",
  /** Publishing while the publish bookmark has commits accepted work lacks (ADR-0076). */
  NOT_FAST_FORWARD: "not_fast_forward",
  /** Publishing while the working copy has conflicts, or catching it up would make some (ADR-0090). */
  YOURS_CONFLICT: "yours_conflict",
  /** An acceptance into a bookmark that is not one of the offer's destinations now. */
  BAD_DESTINATION: "bad_destination",
  /** A new thread's base that is not a WIP bookmark above accepted work. */
  BAD_BASE: "bad_base",
  /** Bringing a thread up to date with a WIP bookmark that is gone (ADR-0104). */
  BASE_GONE: "base_gone",
  /** Catching up with the thread it branched from, for a thread that began at its base (ADR-0072). */
  NO_PARENT: "no_parent",
  /** Catching up with the thread it branched from while that thread's agent runs (ADR-0072). */
  PARENT_RUNNING: "parent_running",
  /**
   * An acceptance that now brings other work than the one it was shown
   * (another ledger), or now conflicts where it did not (ADR-0065).
   */
  OFFER_CHANGED: "offer_changed",
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
/**
 * Which document a host record is written to (ADR-0063): the session's, or a
 * root's.
 */
export type Target =
  | { readonly kind: "session" }
  | { readonly kind: "root"; readonly root: RootId }

export const SESSION_TARGET: Target = { kind: "session" }

/**
 * One write to a pi value at its address, in its document, as the host
 * decides it and pi's session carries it out (ADR-0062). Built by
 * `setRecord` and `deleteRecord` (`@pinetrie/rules`), which take the target from
 * the record's home.
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
 * - `branch`: start a thread, at the root or any message. Every thread
 *   starts this way, and a branch never continues an existing lane: a
 *   compelled one is a new line of work (ADR-0021).
 */
export type ChatMode = "reply" | "branch"

/**
 * Where a message goes (ADR-0117). A send at a thread's `end` names the
 * thread and the entry its sender saw as its end; the host finds the end
 * (`threadEnd`). A `branch` names the new thread the sender's column minted,
 * where it forks (an entry, or null for a thread at the root), and the task
 * its card goes in: a new one the sender's tab minted for a new root, else
 * the task its column is on (ADR-0116). So no send can land anywhere but a
 * thread's end without starting a thread, no thread's end ever gets two
 * continuations, and no thread starts without a place.
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
 * How the host plans a message: a client's mode, or `queue`, for a queued
 * card it pops (ADR-0048). The lane's queue has already decided that card's
 * turn, so only a run makes the lane busy, and a race does not count. A
 * client never sends it: it queues a card instead.
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
       * The root it is written in (ADR-0063): a new one the sender's tab
       * minted for a thread at the root.
       */
      readonly root: RootId
      readonly at: ChatAt
      /** A Start Agent column: with no mention, the agent is asked. */
      readonly asksAgent: boolean
      readonly mentions: readonly Mention[]
      /**
       * The card the text was sent from, spent once it is written or running
       * (ADR-0048), or queued when the lane is busy (ADR-0059).
       */
      readonly card: SentCard | null
      /**
       * Each card pinned at the sender's thread end, with its text version
       * as the sender had it: a run waits for them (ADR-0048, S96).
       */
      readonly pinned: readonly SentCard[]
      /**
       * The WIP bookmark a lane this message creates starts from; null for the
       * line (ADR-0104). Read only when the message creates a lane.
       */
      readonly base: string | null
      /**
       * The workflow state a root this message starts lands in, at its end;
       * null for the first open state (ADR-0122). Read only when it starts one.
       */
      readonly state: WorkflowStateId | null
    }
  /** Name a thread before its lane exists (ADR-0057). */
  | { readonly kind: "reserve"; readonly lane: ThreadId }
  /** Set the sender's display name: a label, never an identity. */
  | { readonly kind: "name"; readonly name: string }
  /** Set the sender's picture to a stored blob, or with null remove it (ADR-0098). */
  | { readonly kind: "picture"; readonly sha256: Sha256 | null }
  /** End a thread's running turn. Idempotent: an idle lane is already stopped. */
  | { readonly kind: "stop"; readonly lane: ThreadId }
  /** Start a new turn on a thread whose last ask was stopped (ADR-0082). */
  | { readonly kind: "carry-on"; readonly lane: ThreadId }
  /**
   * Hold a thread's queue, or release it (ADR-0048 step 7): while it is
   * held, no message card queued there is popped.
   */
  | {
      readonly kind: "queue-hold"
      readonly lane: ThreadId
      readonly held: boolean
    }
  /**
   * Queue a card (ADR-0113): `move` into a lane's queue, and what it does to
   * that queue's hold, decided with the move in one step. A move with no
   * `from` creates the card there, carrying `command`, so the drain the
   * queueing starts pops it with its command.
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
   * Make a text card a thread (ADR-0111): a conversation root, the one its
   * move names (`spun`), whose first message is the card's text, in a new
   * task, `task`, in `state`, or the first open state for null; the card
   * goes to gone, in the history `here` names when it leaves no task.
   */
  | {
      readonly kind: "spin-off"
      readonly move: Move<Extract<PlaceKey, { readonly kind: "gone" }>>
      readonly task: TaskId
      readonly state: WorkflowStateId | null
      /**
       * The task its sender will be on, which names the move's history for
       * a card from an inventory: the new task for a drop in the sidebar,
       * else the one they are on (ADR-0116).
       */
      readonly here: TaskId | null
    }
  /**
   * Move a task on the board (ADR-0122, ADR-0116): from the state its sender
   * saw it in, to `to`, before `before` there, or at its end. Into the
   * archive it archives the task, and out of it restores the task.
   */
  | {
      readonly kind: "move-task"
      readonly task: TaskId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: TaskId | null
    }
  /** Change the session's workflow states (ADR-0122). */
  | { readonly kind: "workflow"; readonly edit: WorkflowEdit }
  /**
   * Title a task or a note column, or clear its title with null (ADR-0045,
   * ADR-0116): one gesture, each title in its own record.
   */
  | {
      readonly kind: "mark"
      readonly of: MarkTarget
      readonly title: string | null
    }
  /** Ask a model for a task's title, from its first thread's messages (ADR-0074). */
  | { readonly kind: "retitle"; readonly task: TaskId }
  /**
   * Act on a lane's offer in your repo (ADR-0105). An acceptance names its
   * destination bookmark, null for the default (ADR-0104), and what it was
   * shown (`seen`, ADR-0065); every other action, null.
   */
  | {
      readonly kind: "offer"
      readonly lane: ThreadId
      readonly action: OfferAction
      readonly to: string | null
      readonly seen: OfferSeen | null
    }
  /** Set up accepted work, or publish it (ADR-0104, ADR-0090). */
  | { readonly kind: AcceptedAction }
  /**
   * Move cards, create one, or remove one (ADR-0059): one move, or a keep's
   * several, accepted whole or refused. The host records it in a task's
   * history of the sender's moves (`historyOf`, ADR-0066); `here`, the task
   * its sender is on, is a discard's from an inventory (ADR-0116).
   */
  | {
      readonly kind: "move"
      readonly moves: readonly TypedMove[]
      readonly here: TaskId | null
    }
  /**
   * Copy the thread `source` (ADR-0117, ADR-0124): a new thread, its id the
   * move's card, forked at `end`, the source's end as its copier saw it,
   * its card made where the move puts it: a spot on a canvas or the
   * copier's inventory.
   */
  | {
      readonly kind: "copy-thread"
      readonly source: ThreadId
      readonly end: EntryId
      readonly move: MoveOf<"thread"> & { readonly from: null }
    }
  /**
   * Make a reference (ADR-0126): a card naming `address`, its quote's blob
   * `quote`, made where `move` sends it (a creation, so it enters no
   * history): your inventory as you take it from the past, or where a
   * reference in your hand is put.
   */
  | {
      readonly kind: "make-reference"
      readonly move: MoveOf<"reference"> & { readonly from: null }
      readonly address: Address
      readonly quote: Sha256
    }
  /**
   * Edit a reference as text (ADR-0126): a new text card, `card`, in its
   * place, its origin the reference's address, and the reference to the
   * trash, as one step of the sender's history. Its sender writes the new
   * card's text, the quote.
   */
  | {
      readonly kind: "edit-as-text"
      readonly reference: ReferenceCardId
      readonly from: PlaceKey
      readonly card: TextCardId
      readonly here: TaskId | null
    }
  /**
   * Move a queued or pinned card among its neighbours (ADR-0048 step 7),
   * recorded in its root's history of the sender's moves (ADR-0066).
   */
  | { readonly kind: "reorder"; readonly reorder: Reorder }
  /**
   * Draw a card on a canvas one column wide or two (ADR-0116), from where
   * its sender saw it (`at`): a compare-and-set, as a reorder is, recorded
   * in the task's history of the sender's moves (ADR-0066).
   */
  | {
      readonly kind: "card-width"
      readonly card: CardId
      readonly at: CanvasKey
      readonly width: CardWidth
    }
  /** Undo or redo the sender's newest move in `task` (ADR-0066). */
  | {
      readonly kind: "undo-move"
      readonly task: TaskId
      readonly direction: MoveDirection
    }
  /** Set a card's command, or clear it with null (ADR-0108). */
  | {
      readonly kind: "set-command"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * The sender has seen these traces of theirs (ADR-0048, *Other people*):
   * the host deletes them. Ids not the sender's are ignored.
   */
  | { readonly kind: "traces-seen"; readonly traces: readonly string[] }

/**
 * What can be done with an offer: accept it into accepted work or a WIP
 * (ADR-0104, ADR-0083), squash a stack back to one revision, have the agent
 * write its description again, or rebuild it, discarding your edits
 * (ADR-0105). Splitting it is a card's command, `split`, popped when the
 * thread is free (ADR-0080).
 */
export type OfferAction = "accept" | "squash" | "describe" | "refresh"
export const OFFER_ACTIONS: readonly OfferAction[] = [
  "accept",
  "squash",
  "describe",
  "refresh",
]

/**
 * What can be done with accepted work: set it up at your `@-`,
 * writing your repo's immutable heads (ADR-0104), or publish it (ADR-0090).
 */
export type AcceptedAction = "setup" | "publish"
export const ACCEPTED_ACTIONS: readonly AcceptedAction[] = ["setup", "publish"]

// --- the board (ADR-0122) ---------------------------------------------------

/** A workflow state: a column of the board. */
export interface WorkflowState {
  readonly id: WorkflowStateId
  readonly name: string
}

/**
 * The session's workflow: a host-written `pinetrie.workflow` singleton. The
 * open states in board order, then the archive, which is always there
 * and always last: a root in it is archived (ADR-0029).
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
 * A task's place on the board (ADR-0116): a host-written `pinetrie.board`
 * value keyed by its `TaskId`. A task has one, written as it starts and as it
 * moves.
 */
export interface BoardPlace {
  readonly task: TaskId
  readonly state: WorkflowStateId
  /** Its order within the state: an order key (S69). */
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

// --- the directory of roots (ADR-0063) --------------------------------------

/**
 * A root as the sidebar, the board and your inbox see it,
 * without its document: a host-written `pinetrie.root` value in the session,
 * keyed by the root's id, refreshed whenever the root's document changes.
 */
export interface RootRecord {
  readonly root: RootId
  /** Its root entry (S30), the tab's key; null before its first message. */
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
   * Per thread, everyone who wrote a chat on its path from the root to its
   * tip, in order of first message: its followers (ADR-0077).
   */
  readonly threads: Readonly<Record<ThreadId, readonly WriterId[]>>
  /**
   * Its chats that name someone (`@`), for the inbox to resolve, each with
   * the thread it is in, which the inbox opens it in (ADR-0116).
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

// --- marks (ADR-0045) --------------------------------------------------------

/**
 * A task's title (ADR-0045, ADR-0116): a host-written `pinetrie.mark` value
 * in the session, keyed by the task's id, so a task has at most one.
 */
export interface MarkRecord {
  readonly task: TaskId
  readonly title: string
  /** The person who set it, or the agent for a title it made unasked. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** What a title names (ADR-0116): a task, or a note column. */
export type MarkTarget =
  | { readonly kind: "task"; readonly task: TaskId }
  | { readonly kind: "note-column"; readonly column: NoteColumnId }

/**
 * A note column's title (ADR-0116): a host-written `pinetrie.note-column`
 * value in the session, keyed by the column's id, absent while untitled.
 * Who made the column is its card's owner, and when is in its id.
 */
export interface NoteColumnRecord {
  readonly column: NoteColumnId
  readonly title: string
  /** The person who set it. */
  readonly by: WriterId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

// --- stops (ADR-0106, ADR-0126) --------------------------------------------

/**
 * Who stopped an ask's run, as a fact in its thread (ADR-0126): queued as a
 * fact card when Stop is pressed, and appended as the run ends, so the
 * agent's next run reads it. pi's entries say a run was aborted, never by
 * whom (S70).
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
   * The message whose budget was spent, when it was the budget that stopped
   * the run, and `by` is whose message it was (ADR-0128); absent for a Stop.
   */
  readonly budget?: EntryId
}

/**
 * Who joined or left a thread's members (ADR-0128): a person dismissed an
 * agent, or the agent left. Read back by `threadMembers`.
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
 * An ask another thread's agent did not answer (ADR-0128): its run was
 * stopped or failed. In the thread that asked; `member` is the asked
 * thread, `by` the person behind the chain.
 */
export interface UnansweredFact {
  readonly kind: "unanswered"
  readonly lane: ThreadId
  readonly member: ThreadId
  readonly why: "stopped" | "failed"
  readonly by: WriterId
}

/** Where a thread is (ADR-0128): `threadReach` (`@pinetrie/rules`) reads it. */
export type Reach =
  | { readonly kind: "open"; readonly task: TaskId }
  | {
      readonly kind: "archived"
      readonly task: TaskId
      readonly record: ArchivedTask
    }
  | { readonly kind: "held"; readonly by: WriterId }
  | { readonly kind: "gone" }

/** A thread out of reach: its task archived, held in an inventory, or gone. */
export type Away = Exclude<Reach, { readonly kind: "open" }>

/**
 * An answer that could not be sent (ADR-0128): the thread that asked went
 * out of reach while it was answered. In the answering thread; `to` is the
 * thread that asked, `why` where it is now.
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
 * What the request after a round of answers told the people (ADR-0128): a
 * line for them, in the thread whose message asked. `by` is whose it was.
 */
export interface RoundFact {
  readonly kind: "round"
  readonly lane: ThreadId
  readonly line: string
  readonly by: WriterId
}

/**
 * Agents spent a budget (ADR-0128): its message's tokens ran out, in the
 * thread whose message set it. `by` is whose message it was.
 */
export interface BudgetSpentFact {
  readonly kind: "budget-spent"
  readonly lane: ThreadId
  readonly budget: EntryId
  readonly limit: number
  readonly by: WriterId
}

/**
 * A thread's queue held (ADR-0048 step 7): a host-written
 * `pinetrie.queue-hold` value in the session, keyed by the lane. While it is
 * there no message card is popped, only facts, until someone releases it.
 */
export interface QueueHold {
  readonly lane: ThreadId
  readonly by: WriterId
  /** When it was held, in ms since the epoch. */
  readonly at: number
}

/** What a digest says (ADR-0075). */
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

/** An ask's digest: replaced whole on each write, so a value, not a text (ADR-0014). */
export interface DigestRecord extends DigestBody {
  /** The ask's prompt: the digest's key. */
  readonly prompt: EntryId
  /** When it was written, in ms since the epoch. */
  readonly at: number
  /** Written after its run ended: kept, and never replaced by a live one. */
  readonly final: boolean
}

/** What a model says a run's end asks of the people in its thread (ADR-0077). */
export type Said = "needsYou" | "worthARead" | "done"

/**
 * How a thread's last run ended (ADR-0077): what happened, never what it
 * asks of whom. Each client decides that for its person (`levelOf`).
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

// --- where lanes work (ADR-0032, ADR-0033) -----------------------------------

/**
 * What stops an editor from opening, for jj and for a lane's shell: a shell
 * with no terminal would wait on one until its timeout (S36 items 13 and 21).
 * With these, a command that wants one fails at once.
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
 * commits the host made, and a race is repaired in your favour (S48 item 8).
 */
export const HOST_OPERATOR = "pinetrie-host"

/**
 * Where a thread's lane starts and is brought up to date from (ADR-0104):
 * accepted work, or a WIP bookmark you chose at its first message.
 */
export type ThreadBase =
  | { readonly kind: "accepted" }
  | { readonly kind: "wip"; readonly bookmark: string }

/** The thread a lane's copy was cloned from, by its lane and its name (ADR-0072). */
export interface ParentThread {
  readonly kind: "parent"
  readonly lane: ThreadId
  readonly name: ThreadName
}

/**
 * Where a lane's working copy sits against its bookmark (ADR-0080), read
 * before a catch-up merges: `@`'s parents, the lane's bookmark, and whether
 * `@`'s one parent descends from it (the agent's own commit).
 */
export interface CopyFacts {
  readonly parents: readonly CommitId[]
  readonly bookmark: CommitId | null
  readonly descends: boolean
}

/** What a catch-up merges from: the thread's base, or the thread it branched from. */
export type CatchUpFrom = ThreadBase | ParentThread

/** A lane's base, read from its history (`@pinetrie/lanes`' `laneBase`, ADR-0104). */
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

/** Where every lane of its own sees its own directory (ADR-0034). */
export const WORKSPACE_ROOT = "/workspace"
/** Where every lane of its own sees your working copy, read-only. */
export const HOST_WORKING_COPY = "/mnt/host-working-copy"

/**
 * The programs the lane runtime carries into every lane of its own, on its
 * `PATH` whatever the image (ADR-0064). Each must be a static build in
 * pinetrie's default image, which the runtime is copied out of.
 */
export const RUNTIME_PROGRAMS = ["jj", "rg", "fd", "sd"] as const
export type RuntimeProgram = (typeof RUNTIME_PROGRAMS)[number]

/** `s` as one POSIX shell word. */
export const shellWord = (s: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Where every lane of its own sees host paths it is granted: `HOST_MOUNT` and
 * then the host path (ADR-0036). One rule, so no granted path can shadow a
 * directory of the image's.
 */
export const HOST_MOUNT = "/mnt/host"

/** A host path, as a lane of its own sees it. */
export const hostPathInLane = (hostPath: string): string =>
  `${HOST_MOUNT}${hostPath}`

/** A command runs a pi skill or expands a pi prompt template (ADR-0036). */
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

/** The commands the host's pi loaded, as people see them (ADR-0036). */
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
/** The project's disk at accepted work's commit, which root lanes fork from (ADR-0104). */
export const BASE_SNAPSHOT = snapshotId("base")

/**
 * A lane's record: a host-written `pinetrie.lane` value keyed by the lane's
 * name, written once, when the lane is created. The setting never changes:
 * a lane's files would stop matching its conversation (ADR-0032).
 */
export interface LaneRecord {
  readonly lane: ThreadId
  /** The root the lane works in (ADR-0063). */
  readonly root: RootId
  /**
   * Whether it works in a copy of its own, in its container (ADR-0102):
   * false for a lane a host without tools made.
   */
  readonly ownCopy: boolean
  readonly by: WriterId
  readonly createdAt: number
}

/**
 * The files at an entry: a host-written `pinetrie.revision` value keyed by the
 * entry's id (ADR-0032, ADR-0034). Every run's prompt has one, and so does
 * every assistant message of a lane of its own that made tool calls. So the
 * nearest record above any entry names its lane, its commit and its disk
 * (`nearestRevision`).
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
   * The paths the turn's commit changed, from the repository's root; none
   * for a prompt's record or a turn with no commit (ADR-0106).
   */
  readonly paths: readonly string[]
  /** The files conflicted in `commit`: what a branch from here starts with (ADR-0072). */
  readonly conflicts: readonly string[]
}

/**
 * What the host found where it runs: a host-written `pinetrie.project` value,
 * rewritten at every start, and only by a host with tools, whose every lane
 * has its own copy (ADR-0102).
 */
export interface ProjectRecord {
  readonly root: string
}

/**
 * A lane's offer: one revision, or a stack, in your repo, holding the lane's
 * work you do not have yet (ADR-0105). A host-written `pinetrie.offer` value
 * keyed by lane: the page's cache, written from the repo after each of the
 * host's steps (`offerRecord`, `@pinetrie/rules`). The host never decides from it: it reads the
 * offer from your repo (`OfferInRepo`), so a record lost or stale changes
 * nothing. What accepting it would bring, each revision's description,
 * files and diffs, is not stored: the page reads it by commit when it asks
 * (`RevisionReview`, ADR-0047).
 */
export interface OfferRecord {
  readonly lane: ThreadId
  /** Its revisions: 1 for a single offer, more for a stack. */
  readonly size: number
  /** The lane turned since the stack was made: it no longer holds all of it. */
  readonly stale: boolean
  /** None when accepted work already holds its work (`offerStatus`'s `held`, S89). */
  readonly files: readonly string[]
  /** Files that conflict with your committed work (S48 item 3). */
  readonly conflicts: readonly string[]
  /**
   * The files conflicted where it starts, read only when it conflicts:
   * those of `conflicts` among them came with the lane's copy
   * (`conflictCause`, ADR-0072).
   */
  readonly startConflicts: readonly string[]
  /** Files it touches that you are editing in `@` (S48 item 4). */
  readonly yourEdits: readonly string[]
  /** An agent wrote its description; false while it carries the placeholder. */
  readonly described: boolean
  /** You edited it since the host last wrote it: the host leaves it alone. */
  readonly edited: boolean
  /** Its bookmark in your repo, as jjui shows it. */
  readonly bookmark: string
  /**
   * The change id its top became when you accepted it; null while it is
   * open. Stored as `taken` before ADR-0083: `offerRecord` still reads that.
   */
  readonly acceptedAs: string | null
  /**
   * Each revision's commit as the host last read it, bottom first: what a
   * review may read. It follows a rebase jj made under the offer, and your
   * edits.
   */
  readonly commits: readonly CommitId[]
  /**
   * What it brings, as its top's message says (`offerLedger`): the lane tip
   * it holds and where it starts. An acceptance names it (`OfferSeen`,
   * ADR-0065).
   * Null for an offer whose message carries none, and for a record written
   * before the field, until the owner's first observation writes it again.
   */
  readonly ledger: OfferLedger | null
  readonly at: number
}

/**
 * Where an offer's conflict comes from (`conflictCause`): the lane's work
 * against its target, or the copy it was cloned with, every conflicted file
 * already conflicted where it starts (ADR-0072).
 */
export type ConflictCause = "work" | "start"

/** How jj says a file changed in a revision. */
export type FileChange = "added" | "modified" | "removed" | "copied" | "renamed"

/** One file of one revision, as jj's diff stats read it (S57). */
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
 * content, so this never changes for a commit (ADR-0047).
 */
export interface RevisionReview {
  /** Its description, the host's trailers included. */
  readonly description: string
  readonly files: readonly ReviewFile[]
}

/**
 * What a review reads (ADR-0047, ADR-0106): one revision, the diff from its
 * parent to it, or a range, the diff from one commit to another, such as an
 * ask's work across its turns' revisions. Commit ids name their content, so
 * a review of either never changes.
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
 * What a fork starts on (ADR-0104): a commit a lane recorded (a branch below
 * agent work), accepted work's commit, or a copy of a WIP bookmark made on the
 * accepted commit under it, so the lane freezes nothing of yours.
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
 * commit, or a fresh copy of a WIP (ADR-0104); or the newest commit of the
 * thread it branched from (ADR-0072).
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
 * A thread's name as people say it: two words, `amber-fox` (ADR-0039). Minted
 * by `@pinetrie/rules`' naming and its decoder; stored, never recomputed.
 */
export type ThreadName = string & { readonly [threadNameBrand]: true }

/** A lane's name: a host-written `pinetrie.name` value keyed by the lane (ADR-0039). */
export interface NameRecord {
  readonly lane: ThreadId
  readonly name: ThreadName
  readonly at: number
}

/**
 * The image behind a thread's column header: a host-written `pinetrie.banner`
 * value keyed by the lane. The image is a blob (ADR-0042); a replaced one is
 * no longer referenced, and the blob sweep deletes it.
 */
export interface BannerRecord {
  readonly lane: ThreadId
  readonly sha: Sha256
  readonly at: number
}

/**
 * Accepted work in your repo, as the host last read it (ADR-0104): a
 * host-written `pinetrie.accepted` value, a cache the page reads. The repo is the
 * truth; the host rewrites this whenever your repo's operation head moves.
 */
export interface AcceptedRecord {
  /** Accepted work's bookmark, and the prefix that makes a bookmark a WIP. */
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  /** The bookmark publishing moves forward to accepted work (ADR-0076). */
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
   * jj's default log (S77 item 8).
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
   * The publish bookmark against accepted work (ADR-0076): its commit (null when
   * the repo has none), accepted commits it lacks (`behind`: what publishing
   * moves it over) and its commits accepted work lacks (`ahead`: publishing is a
   * fast-forward only at 0). Both 0 before accepted work is set up.
   */
  readonly published: {
    readonly commit: CommitId | null
    readonly behind: number
    readonly ahead: number
  }
  /**
   * Your `@-` against accepted work: accepted commits it lacks (`behind`), and
   * your commits below `@` accepted work lacks (`ahead`, `::@- ~ ::<accepted>`: what
   * a publish accepts, ADR-0090). `catchUp` is what catching the working copy
   * up would do (S80): how many files change, those that conflict, and your
   * other heads that move with `@`; null when nothing is behind, or `@`
   * shares no commit with accepted work. `conflicts` are your conflicted commits
   * above accepted work, `@` included, and the conflicted files in `@`.
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
   * `publish.catchUp` (ADR-0099): whether a publish catches the working copy up and
   * accepts your commits below `@` before moving the publish bookmark.
   */
  readonly publishCatchesUp: boolean
}

/**
 * A thread's base as its lane's history says it (ADR-0104): a host-written
 * `pinetrie.base` value keyed by lane, a cache the page reads. `start` is the
 * commit the lane's newest `Pinetrie-Base` trailer names, or accepted commit it
 * forked from when it has none.
 */
export interface BaseRecord {
  readonly lane: ThreadId
  readonly base: ThreadBase
  readonly start: CommitId
  /** A WIP base: on accepted work now (landed), gone without landing, or neither. */
  readonly state: "ok" | "landed" | "gone"
  /**
   * What catching up would change, read at the lane's tip and the base's
   * commit then (S97); null when the base had not moved, or jj could not
   * say. A reader whose base has moved since reads it as unknown.
   */
  readonly catchUp: CatchUpRead | null
  /**
   * Accepted-offer commits of this thread on accepted work, above its base,
   * that name no source (`untracedLanes`, S97): nothing is offered until it
   * catches up past them.
   */
  readonly untraced: readonly CommitId[]
  /**
   * Whether the lane's work since its start changes any file (ADR-0067):
   * `unknown` for an untraced start, or one jj could not diff. A thread is
   * told its base has new work only with `some`, and caught up quietly only
   * with `none` (ADR-0080).
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
 * A seat the host has seen: its Kyneta peer, the Yjs `clientID` its
 * operations carry, and the person it is (ADR-0037). A host-written
 * `pinetrie.seat` value keyed by the peer, so anyone can name who wrote in a
 * text after the seat has gone.
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

/** A person's picture (ADR-0098): a blob, keyed by their writer. */
export interface PictureRecord {
  readonly writer: WriterId
  readonly sha256: Sha256
}

// --- obligation: collaborators and compelled responders ----------------------

/**
 * An `@` in a message. Mentioning the agent COMPELS it to reply. Mentioning a
 * person addresses them, and so leaves the agent out; nobody can make a human
 * answer (ADR-0021). A person mention counts only if it names a participant
 * (`address`).
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

/**
 * `text` with its code blanked out, each character a space and each line
 * break kept: fenced blocks (``` or ~~~, to their closing fence or the end)
 * and inline code spans (a run of backticks to the next run as long). A
 * four-space indented block is left as it is: it needs the block's context,
 * which a line scan does not have. Pure.
 */
function withoutCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ")
  const fenced = text.replace(
    /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm,
    blank,
  )
  return fenced.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}

/**
 * Every `@handle` in `text`, in order, without repeats, outside code
 * (`withoutCode`): a handle in a code span or a fenced block is text.
 * `@agent` is the agent; any other handle is read as a person here, and
 * `address` finds whether it names another thread's agent instead
 * (ADR-0128). A handle starts a word, so an e-mail address is not a mention.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  const pattern = new RegExp(
    `(?<![${HANDLE_CHARS}@])@([${HANDLE_CHARS}]+)`,
    "gu",
  )
  for (const [, handle] of withoutCode(text).matchAll(pattern)) {
    if (handle === undefined || seen.has(handle)) continue
    seen.add(handle)
    out.push(
      handle === THE_AGENT
        ? { kind: "agent", agent: THE_AGENT }
        : { kind: "person", name: handle },
    )
  }
  return out
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

/** Who asked another thread's agent (ADR-0128): a person, or a thread's agent. */
export type Asker =
  | { readonly kind: "person"; readonly writer: WriterId }
  | { readonly kind: "agent"; readonly thread: ThreadId }

/**
 * An ask relayed into another thread (ADR-0128), the asked agent's prompt:
 * where it was asked, by whom, and what. `budget` is the person's message
 * whose budget the chain spends (its run spends from it only when an agent
 * asked); `by` is the person behind the chain, who a stop, a card or a
 * run's author names.
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
 * An asked agent's answer, in the thread that asked (ADR-0128): its last
 * message of the run its relay started. `wakes` says whether it started a
 * run of the asking agent.
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
 * What an asked agent heard of the thread that asked (ADR-0128): those
 * entries' ids, newest last. Their text is the heard entry's `content`.
 */
export interface HeardDetails {
  readonly from: ThreadId
  readonly fromName: string
  readonly entries: readonly EntryId[]
}

/**
 * Another thread's agent a mention may reach (ADR-0128): a thread on the
 * open task's canvas other than the one written in, by its name. `member` says
 * whether it was invited into the thread written in already.
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
  /** Members, other threads' agents, that it asks: each runs (ADR-0128). */
  readonly asks: readonly ThreadId[]
  /** Other threads' agents it invites: they become members, asked or not. */
  readonly invites: readonly ThreadId[]
}

/**
 * Who a message is for (ADR-0021, ADR-0128). A handle that is a candidate
 * agent's name is that agent, before any person: a member is asked, any
 * other invited. `@agent` compels this thread's agent. Otherwise a message
 * naming participants or asking members is for them, and the agent is left
 * out; an invite alone leaves the message where it would have gone.
 * Otherwise the thread decides: the agent where it is the default (a thread
 * with a lane, or a Start Agent column), nobody where it is not. A message
 * that then compels nobody, names no one and asks no member asks the agents
 * it invites, since nobody else would answer.
 *
 * A handle that names no participant and no candidate is ignored, so
 * `@types/node` in agent work still asks the agent. Pure; the composer and
 * the host both call it.
 */
export function address(input: {
  readonly mentions: readonly Mention[]
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  /** Other threads' agents on open tasks' canvases (ADR-0128). */
  readonly agents: readonly AgentCandidate[]
  readonly agentByDefault: boolean
}): Recipients {
  const byHandle = new Map(input.participants.map(n => [handleOf(n), n]))
  const agentByHandle = new Map(
    input.agents.map(a => [handleOf(a.name), a] as const),
  )
  const people: string[] = []
  const asks: ThreadId[] = []
  const invites: ThreadId[] = []
  for (const m of input.mentions) {
    if (m.kind !== "person") continue
    const handle = handleOf(m.name)
    const agent = agentByHandle.get(handle)
    if (agent !== undefined) {
      const into = agent.member ? asks : invites
      if (!into.includes(agent.thread)) into.push(agent.thread)
      continue
    }
    const person = byHandle.get(handle)
    if (person !== undefined) people.push(person)
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
 * `@agent`, which is always the agent, or a thread's name, which is always
 * that thread's agent: ADR-0128).
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

// --- wire hygiene (ADR-0013) ------------------------------------------------

/**
 * Returns the paths at which a `seq` key appears, so a test can assert none do.
 *
 * Where this does real work: STORED ENTRIES. The doc types them
 * `Schema.record(Schema.any())`, so any shape at all can be written and
 * nothing strips a stray key. Proven: writing `{ ...entry, seq: 99 }` makes
 * the e2e stored-seq check FAIL.
 *
 * Where it does NOT: LINE MESSAGES. `packages/protocol/line.ts` declares Command and
 * Reply as `Schema.struct({...})`, and Kyneta encodes only declared fields, so
 * an undeclared `seq` is dropped at the boundary. Proven: a reply sent as
 * `{ ...reply, seq: 1 }` arrives without it, and the e2e wire-seq check still
 * passes. That check is kept for the case the struct itself grows a `seq`, but
 * it is NOT what keeps seq off the wire — the struct is.
 *
 * A deleted `LocalSeq` brand used to be credited with this. It could never
 * have worked: brands constrain how a value is CREATED, while the risk for seq
 * is how it is SERIALIZED, and a branded number drops into any `number` field
 * with no error. Contrast `ThreadId`, where creation IS the danger (a writer's
 * id or "main" used as a lane, ADR-0120) and the brand therefore does real
 * work.
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

// ── arrival ordering (ADR-0013) ───────────────────────────────────────────

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
 * This is the derivation behind the arrival seq, and it is pure so the claim
 * ADR-0013 actually rests on can be *tested* rather than asserted: the result
 * must not depend on the order the candidates arrive in. Two replicas seeing
 * the same delta in different orders must assign the same sequence, or stable
 * cursors silently skip entries.
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
export * from "./edits.ts"
export * from "./errors.ts"
export * from "./grid.ts"
export * from "./images.ts"
export * from "./kinds.ts"
export * from "./live.ts"
export * from "./offers.ts"
export * from "./paths.ts"
export * from "./places.ts"
export * from "./roots.ts"
export * from "./thread-names.ts"
export * from "./tools.ts"
export * from "./trailers.ts"
export * from "./tree.ts"
export * from "./work.ts"
