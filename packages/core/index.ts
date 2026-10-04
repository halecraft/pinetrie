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
// What belongs here, as `@pineta/rules` and `@pineta/repo` state it too: core holds the vocabulary (ids, intents, every record's type)
// and the reads of the tree. A format or type that `lanes` or `repo` must
// read, write or name lives in core too, since neither can declare
// `@pineta/rules`. What a stored shape says, and how the host changes it, is
// `@pineta/rules`', whoever reads it.

import type { Sha256 } from "./images.ts"
import type { OfferLedger, OfferSeen } from "./offers.ts"

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
 * (ADR-0020).
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

declare const laneNameBrand: unique symbol
/**
 * A thread's lane: a line of work (ADR-0019), never moved (ADR-0020). Its id
 * can exist before the lane does: a column reserves it, and the thread is
 * named under it (ADR-0057). `laneNameForThread()` and `parseNewLane()` mint
 * one, and every reader of a stored or sent name checks it with `isLaneName()`,
 * so no writer's id or `"main"` is one.
 */
export type LaneName = string & { readonly [laneNameBrand]: true }

const LANE_PREFIX = "t-"

/** A new thread lane's name, from a fresh coordination-free id. */
export const laneNameForThread = (id: string): LaneName =>
  `${LANE_PREFIX}${id}` as LaneName

/**
 * Whether text names a thread's lane: the check wherever a lane name is read,
 * in the codec, the schema's readers, `@pineta/rules`' decoders and the pi adapter.
 */
export const isLaneName = (s: string): s is LaneName =>
  s.startsWith(LANE_PREFIX) && s.length > LANE_PREFIX.length

const NEW_LANE =
  /^t-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * A new thread's lane id as a client makes it, `t-` and a lowercase uuidv7;
 * undefined for anything else. Stricter than `isLaneName`: a lane's
 * container and volume are named after its id (ADR-0057).
 */
export const parseNewLane = (s: string): LaneName | undefined =>
  NEW_LANE.test(s) ? (s as LaneName) : undefined

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
 * The host's undo stack of `writer`'s moves in `root` (ADR-0066): only the
 * host holds it.
 */
export const movesDocId = (writer: WriterId, root: RootId): string =>
  `${MOVES_DOC_PREFIX}${writer}:${root}`

/**
 * A document id -> the writer and root whose moves' stack it is, or
 * undefined for any other document. A root's id holds no `:`.
 */
export function movesOfDocId(
  docId: string,
): { readonly writer: WriterId; readonly root: RootId } | undefined {
  if (!docId.startsWith(MOVES_DOC_PREFIX)) return undefined
  const rest = docId.slice(MOVES_DOC_PREFIX.length)
  const cut = rest.lastIndexOf(":")
  if (cut <= 0) return undefined
  const root = rest.slice(cut + 1)
  return isRootId(root)
    ? { writer: rest.slice(0, cut) as WriterId, root }
    : undefined
}

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Positions take an entry id; `activeRuns` holds run ids. Passing
 * one where the other belongs would otherwise compile, run, and fail
 * silently. Mint them only where they enter: the protocol codec, the reads,
 * the schema's readers, `@pineta/rules`' decoders, the pi adapter, the client's
 * stored forms, and the host's id generator. `biome.json` refuses an
 * `entryId` import in core, the client and the host, and a `runId` import in
 * core and the client (S95).
 */
export type EntryId = string & { readonly [entryIdBrand]: true }
export type RunId = string & { readonly [runIdBrand]: true }
export const entryId = (id: string): EntryId => id as EntryId
export const runId = (id: string): RunId => id as RunId
declare const cardIdBrand: unique symbol
/** A card's id, uuidv7: the key of its record and the name of its text's document (ADR-0048). */
export type CardId = string & { readonly [cardIdBrand]: true }
export const cardId = (id: string): CardId => id as CardId

declare const agentIdBrand: unique symbol
/** An agent that can be compelled to reply. The host has exactly one for now. */
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
  /** A write in a root someone archived (ADR-0029). The message names them. */
  ARCHIVED: "archived",
  /** Archiving a root where the agent is working or cards are queued. */
  ROOT_BUSY: "root_busy",
  /** A lane pi holds an operation open on: after a crash, until it resumes. */
  BUSY: "busy",
  /** Landing a lane that has no copy of its own: it works directly. */
  NOT_OWN_COPY: "not_own_copy",
  /** An offer action on a lane with no offer in your repo (ADR-0038). */
  NO_OFFER: "no_offer",
  /** A lane asked to work directly in a directory that is not one. */
  BAD_DIRECTORY: "bad_directory",
  /** A `/package:name` command that names no command there is (ADR-0036). */
  UNKNOWN_COMMAND: "unknown_command",
  /** A peer whose principal is not an email: nobody the host can name. */
  INVALID_IDENTITY: "invalid_identity",
  /** A message shows a `/blob/` image the host does not store (ADR-0042). */
  IMAGE_MISSING: "image_missing",
  /** A title with a line break, or longer than `MAX_TITLE` (ADR-0045). */
  INVALID_TITLE: "invalid_title",
  /** A new thread's lane id that names a lane pi already holds (ADR-0057). */
  LANE_ID_IN_USE: "lane_id_in_use",
  /** A new root's id that names a root the session already holds (ADR-0063). */
  ROOT_ID_IN_USE: "root_id_in_use",
  /**
   * A command that acts on the repo as its owner (set up the line, land your
   * work) from a host that admits others: it has an invite key (ADR-0060).
   */
  NOT_YOURS: "not_yours",
  /** An offer integrated, or work landed, before the line is set up (ADR-0060). */
  NO_LINE: "no_line",
  /** Publishing in a repo with no publish bookmark (ADR-0076). */
  NO_PUBLISH: "no_publish",
  /** Publishing while the publish bookmark has commits the line lacks (ADR-0076). */
  NOT_FAST_FORWARD: "not_fast_forward",
  /** An offer integration into a bookmark that is not one of the offer's destinations now. */
  BAD_DESTINATION: "bad_destination",
  /** A new thread's base that is not a WIP bookmark above the line. */
  BAD_BASE: "bad_base",
  /** Bringing a thread up to date with a WIP bookmark that is gone (ADR-0060). */
  BASE_GONE: "base_gone",
  /** Catching up with the thread it branched from, for a thread that began at its base (ADR-0072). */
  NO_PARENT: "no_parent",
  /** Catching up with the thread it branched from while that thread's agent runs (ADR-0072). */
  PARENT_RUNNING: "parent_running",
  /**
   * An offer integration that now brings other work than the one it was shown
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
export type HostNamespace = `pineta.${string}`

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
 * `setRecord` and `deleteRecord` (`@pineta/rules`), which take the target from
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
 * - `reply`: continue the thread I am reading; I saw it end at `at`. If
 *   another writer compelled the agent there since, that is a race, and the
 *   sender is told (`conflict`) rather than guessed for.
 * - `branch`: start a thread at `at`, the root or any message. Every thread
 *   starts this way, and a branch never continues an existing lane: a
 *   compelled one is a new line of work (ADR-0021).
 */
export type ChatMode = "reply" | "branch"
export const CHAT_MODES: readonly ChatMode[] = ["reply", "branch"]

/**
 * How the host plans a message: a client's mode, or `queue`, for a queued
 * card it pops (ADR-0048). The lane's queue has already decided that card's
 * turn, so only a run makes the lane busy, and a race does not count. A
 * client never sends it: it queues a card instead.
 */
export type PlanMode = ChatMode | "queue"

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule, so this type cannot express a
 * malformed command. What it then does is decided by `planChat` and the
 * other planners in `@pineta/rules`, over what the host gathers.
 */
export type Intent =
  /** A human message; `mentions` are parsed from `text` once, at the codec. */
  | {
      readonly kind: "chat"
      readonly text: string
      /**
       * The root it is written in (ADR-0063), with `at` a `Spot`: a new one
       * the sender's tab minted for a thread at the root.
       */
      readonly root: RootId
      readonly at: Position
      readonly mode: ChatMode
      /** The lane the sender's column is bound to: its thread, named. */
      readonly lane: LaneName | null
      /** A Start Agent column: with no mention, the agent is asked. */
      readonly asksAgent: boolean
      readonly mentions: readonly Mention[]
      /**
       * Where a lane this message creates works: its own copy, or directly in
       * a directory. Null: the lane above's setting, else the project's
       * default (ADR-0032). Read only when the message creates a lane.
       */
      readonly work: WorkSetting | null
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
       * The lane id the sender's column reserved: the id a lane this message
       * creates is created under, unless pi holds it (ADR-0057).
       */
      readonly reserved: LaneName | null
      /**
       * The WIP bookmark a lane this message creates starts from; null for the
       * line (ADR-0060). Read only when the message creates a lane.
       */
      readonly base: string | null
    }
  /** Name a thread before its lane exists (ADR-0057). */
  | { readonly kind: "reserve"; readonly lane: LaneName }
  /** Set the sender's display name: a label, never an identity. */
  | { readonly kind: "name"; readonly name: string }
  /** End a thread's running turn. Idempotent: an idle lane is already stopped. */
  | { readonly kind: "stop"; readonly lane: LaneName }
  /** Start a new turn on a thread whose last ask was stopped (ADR-0082). */
  | { readonly kind: "carry-on"; readonly lane: LaneName }
  /** Hide a root for everyone, or bring it back (ADR-0029). */
  | {
      readonly kind: "archive"
      readonly action: ArchiveAction
      readonly root: EntryId
    }
  /** Title an entry, or clear its title with null (ADR-0045). */
  | {
      readonly kind: "mark"
      /** The root the entry is in (ADR-0063). */
      readonly root: RootId
      readonly entry: EntryId
      readonly title: string | null
    }
  /** Ask a model for a root's title, from its messages (ADR-0074). */
  | { readonly kind: "retitle"; readonly root: RootId }
  /**
   * Act on a lane's offer in your repo (ADR-0038). An integration names its
   * destination bookmark, null for the default (ADR-0060), and what it was
   * shown (`seen`, ADR-0065); every other action, null.
   */
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
      readonly seen: OfferSeen | null
    }
  /** Set up the integration line, or land your work on it (ADR-0060). */
  | { readonly kind: "line"; readonly action: LineAction }
  /**
   * Move cards, create one, or remove one (ADR-0059): one move, or a keep's
   * several, accepted whole or refused. The host records it in a root's
   * history of the sender's moves (`historyOf`, ADR-0066).
   */
  | { readonly kind: "move"; readonly moves: readonly Move[] }
  /** Undo or redo the sender's newest move in `root` (ADR-0066). */
  | {
      readonly kind: "undo-move"
      readonly root: RootId
      readonly direction: MoveDirection
    }
  /** Set a card's command, or clear it with null (ADR-0055). */
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
 * What can be done with an offer: integrate it into the line or a WIP
 * (ADR-0060, ADR-0083), have the agent split it into a stack, squash a stack
 * back to one revision, have the agent write its description again, or
 * rebuild it, discarding your edits (ADR-0038).
 */
export type OfferAction =
  | "integrate"
  | "split"
  | "squash"
  | "describe"
  | "refresh"
export const OFFER_ACTIONS: readonly OfferAction[] = [
  "integrate",
  "split",
  "squash",
  "describe",
  "refresh",
]

/**
 * What can be done with the integration line (ADR-0060): set it up at your
 * `@-`, writing your repo's immutable heads, or land your work on it.
 */
export type LineAction = "setup" | "land" | "follow" | "publish"
export const LINE_ACTIONS: readonly LineAction[] = [
  "setup",
  "land",
  "follow",
  "publish",
]

// --- the archive (ADR-0029) --------------------------------------------------

export type ArchiveAction = "archive" | "restore"
export const ARCHIVE_ACTIONS: readonly ArchiveAction[] = ["archive", "restore"]

/**
 * A root's archive record: a host-written `pineta.archive` value keyed by the
 * root's entry id. Archiving deletes nothing; a restored root keeps its record.
 */
export interface ArchiveRecord {
  readonly root: EntryId
  readonly state: "archived" | "restored"
  readonly by: WriterId
  /** When it last changed, in ms since the epoch. */
  readonly at: number
}

// --- the directory of roots (ADR-0063) --------------------------------------

/**
 * A root as the tabs, the Archive tab, the inbox and the header see it,
 * without its document: a host-written `pineta.root` value in the session,
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
  /** Its root entry's mark (ADR-0045), or null. */
  readonly title: string | null
  /** Its messages: the rail's rows. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId | null
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
  /**
   * Per thread, everyone who wrote a chat on its path from the root to its
   * tip, in order of first message: its followers (ADR-0077). A record
   * written before the field holds none.
   */
  readonly threads: Readonly<Record<LaneName, readonly WriterId[]>>
  /** Its chats that name someone (`@`), for the inbox to resolve. */
  readonly mentions: readonly {
    readonly id: EntryId
    readonly by: WriterId
    readonly text: string
  }[]
  /** Every image it shows (`referencedBlobs`), for the image sweep. */
  readonly images: readonly Sha256[]
}

// --- marks (ADR-0045) --------------------------------------------------------

/**
 * A title on an entry: a host-written `pineta.mark` value keyed by the
 * entry's id, so an entry has at most one. A root's mark titles its tab.
 */
export interface MarkRecord {
  readonly entry: EntryId
  readonly title: string
  /** The person who set it, or the agent for a title it made unasked. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

// --- stops (ADR-0056) --------------------------------------------------------

/**
 * Who stopped an ask's run: a host-written `pineta.stop` value keyed by the
 * ask's prompt. pi's entries say a run was aborted, never by whom (S70).
 */
export interface StopRecord {
  readonly prompt: EntryId
  readonly by: WriterId
  /** When Stop was pressed, in ms since the epoch. */
  readonly at: number
}

/** What a digest says (ADR-0075). */
export interface DigestBody {
  /**
   * One line of at most `HEADLINE_WORDS` words (`@pineta/rules`'
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
  readonly lane: LaneName
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
 * The user every host operation on your repo carries, so the evolog says which
 * commits the host made, and a race is repaired in your favour (S48 item 8).
 */
export const HOST_OPERATOR = "pineta-host"

/**
 * Where a thread's lane starts and is brought up to date from (ADR-0060):
 * the integration line, or a WIP bookmark you chose at its first message.
 */
export type ThreadBase =
  | { readonly kind: "line" }
  | { readonly kind: "wip"; readonly bookmark: string }

/** The thread a lane's copy was cloned from, by its lane and its name (ADR-0072). */
export interface ParentThread {
  readonly kind: "parent"
  readonly lane: LaneName
  readonly name: ThreadName
}

/** What a catch-up merges from: the thread's base, or the thread it branched from. */
export type CatchUpFrom = ThreadBase | ParentThread

/** A lane's base, read from its history (`@pineta/lanes`' `laneBase`, ADR-0060). */
export interface LaneBase {
  readonly base: ThreadBase
  /**
   * Where the lane's own work begins: the line commit its base names, or the
   * WIP's copy; for a lane with no `Pineta-Base`, the newest line commit in
   * its history.
   */
  readonly start: CommitId
  /**
   * The commit of yours the lane holds whole since its base: the one its
   * `Pineta-Base` names (the WIP's, for a WIP, never the copy); for a lane
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
 * Pineta's default image, which the runtime is copied out of.
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
 * to, or `"base"`. Its file is `.pineta/snapshots/<id>.img`. One snapshot
 * per record, so a turn retried after a crash writes the same file.
 */
export type SnapshotId = string & { readonly [snapshotIdBrand]: true }
export const snapshotId = (id: string): SnapshotId => id as SnapshotId
/** The project's disk at the line's commit, which root lanes fork from (ADR-0060). */
export const BASE_SNAPSHOT = snapshotId("base")

/** Where a lane's tools work: its own container and disk, or directly in a directory. */
export type WorkSetting =
  | { readonly kind: "own" }
  | { readonly kind: "direct"; readonly dir: string }

/**
 * A lane's record: a host-written `pineta.lane` value keyed by the lane's
 * name, written once, when the lane is created. The setting never changes:
 * a lane's files would stop matching its conversation (ADR-0032).
 */
export interface LaneRecord {
  readonly lane: LaneName
  /** The root the lane works in (ADR-0063). */
  readonly root: RootId
  /** Its own copy, or a directory; null for a lane with no work of its own. */
  readonly work: WorkSetting | null
  readonly by: WriterId
  readonly createdAt: number
}

/**
 * The files at an entry: a host-written `pineta.revision` value keyed by the
 * entry's id (ADR-0032, ADR-0034). Every run's prompt has one, and so does
 * every assistant message of a lane of its own that made tool calls. So the
 * nearest record above any entry names its lane, its commit and its disk
 * (`nearestRevision`).
 */
export interface RevisionRecord {
  readonly entry: EntryId
  readonly lane: LaneName
  /** The turn's commit; null when nothing tracked changed, or the lane works directly. */
  readonly commit: CommitId | null
  /**
   * The lane's whole disk at this entry; null for a lane that works directly,
   * and in records written before lane containers.
   */
  readonly snapshot: SnapshotId | null
  /**
   * The paths the turn's commit changed, from the repository's root; none
   * for a prompt's record or a turn with no commit (ADR-0056).
   */
  readonly paths: readonly string[]
  /** The files conflicted in `commit`: what a branch from here starts with (ADR-0072). */
  readonly conflicts: readonly string[]
}

/**
 * What the host found where it runs: a host-written `pineta.project` value,
 * rewritten at every start. With `direct`, no lane can have its own copy, and
 * `reason` says why (no repo, or no usable `container`). With `lanes`, a new
 * root lane gets `rootDefault` (`PINETA_LANES=0` makes it `direct`), and any
 * lane may choose either.
 */
export type ProjectRecord =
  | {
      readonly kind: "lanes"
      readonly root: string
      readonly rootDefault: "own" | "direct"
    }
  | { readonly kind: "direct"; readonly root: string; readonly reason: string }

/**
 * How a resolution run ended: a host-written `pineta.landing` value keyed by
 * its own id, written when its run ends. A resolution in progress has no
 * record: it is a running lane whose prompt is a land message (ADR-0033).
 */
export interface LandingRecord {
  readonly id: string
  readonly lane: LaneName
  /** The land message that started it. */
  readonly prompt: EntryId
  readonly state: "resolved" | "needs_you"
  readonly by: WriterId
  readonly at: number
}

/**
 * A lane's offer: one revision, or a stack, in your repo, holding the lane's
 * work you do not have yet (ADR-0038). A host-written `pineta.offer` value
 * keyed by lane: the page's cache, written from the repo after each of the
 * host's steps (`offerRecord`, `@pineta/rules`). The host never decides from it: it reads the
 * offer from your repo (`OfferInRepo`), so a record lost or stale changes
 * nothing. What integrating it would bring, each revision's description,
 * files and diffs, is not stored: the page reads it by commit when it asks
 * (`RevisionReview`, ADR-0047).
 */
export interface OfferRecord {
  readonly lane: LaneName
  /** Its revisions: 1 for a single offer, more for a stack. */
  readonly size: number
  /** The lane turned since the stack was made: it no longer holds all of it. */
  readonly stale: boolean
  /** None when the line already holds its work (`offerStatus`'s `held`, S89). */
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
   * The change id its top became when you integrated it; null while it is
   * open. Stored as `taken` before ADR-0083: `offerRecord` still reads that.
   */
  readonly integratedAs: string | null
  /**
   * Each revision's commit as the host last read it, bottom first: what a
   * review may read. It follows a rebase jj made under the offer, and your
   * edits.
   */
  readonly commits: readonly CommitId[]
  /**
   * What it brings, as its top's message says (`offerLedger`): the lane tip
   * it holds and where it starts. An integration names it (`OfferSeen`,
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
 * What a review reads (ADR-0047, ADR-0056): one revision, the diff from its
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
 * What a fork starts on (ADR-0060): a commit a lane recorded (a branch below
 * agent work), the line's commit, or a copy of a WIP bookmark made on the
 * line commit under it, so the lane freezes nothing of yours.
 */
export type ForkStart =
  | { readonly kind: "commits"; readonly commits: readonly CommitId[] }
  | { readonly kind: "line"; readonly onto: string; readonly commit: CommitId }
  | {
      readonly kind: "wip"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** The line commit under the WIP: the copy's parent. */
      readonly under: CommitId
    }

/**
 * What bringing a thread up to date merges into its lane: the line's
 * commit, or a fresh copy of a WIP (ADR-0060); or the newest commit of the
 * thread it branched from (ADR-0072).
 */
export type BaseMerge =
  | {
      readonly kind: "line"
      readonly onto: string
      readonly commit: CommitId
      /** The thread moves to the line: with nothing to merge, a commit still names it. */
      readonly mark: boolean
    }
  | {
      readonly kind: "wip"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** The line commit under the WIP: where the commits that came in start. */
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
 * by `@pineta/rules`' naming and its decoder; stored, never recomputed.
 */
export type ThreadName = string & { readonly [threadNameBrand]: true }

/** A lane's name: a host-written `pineta.name` value keyed by the lane (ADR-0039). */
export interface NameRecord {
  readonly lane: LaneName
  readonly name: ThreadName
  readonly at: number
}

/**
 * The image behind a thread's column header: a host-written `pineta.banner`
 * value keyed by the lane. The image is a blob (ADR-0042); a replaced one is
 * no longer referenced, and the blob sweep deletes it.
 */
export interface BannerRecord {
  readonly lane: LaneName
  readonly sha: Sha256
  readonly at: number
}

/**
 * The integration line in your repo, as the host last read it (ADR-0060): a
 * host-written `pineta.line` value, a cache the page reads. The repo is the
 * truth; the host rewrites this whenever your repo's operation head moves.
 */
export interface LineRecord {
  /** The line's bookmark, and the prefix that makes a bookmark a WIP. */
  readonly onto: string
  readonly wipPrefix: string
  /** The bookmark publishing moves forward to the line (ADR-0076). */
  readonly publish: string
  /** The line's commit; null before it is set up. */
  readonly commit: CommitId | null
  /**
   * Your repo's `immutable_heads()` now (null: jj's builtin), and what
   * setting up the line writes. Equal once it is written.
   */
  readonly heads: { readonly current: string | null; readonly proposed: string }
  /**
   * Your repo's `revsets.log` now (null: jj's default), and what setting up
   * the line writes: the offers added, since an immutable head is out of
   * jj's default log (S77 item 8).
   */
  readonly log: { readonly current: string | null; readonly proposed: string }
  /** The WIP bookmarks a thread may start from, newest first. */
  readonly wips: readonly {
    readonly bookmark: string
    readonly commit: CommitId
    /** Line commits it lacks: how far it is behind the line. */
    readonly behind: number
    /** Its commits not on the line: what lands with it. */
    readonly ahead: number
  }[]
  /**
   * The publish bookmark against the line (ADR-0076): its commit (null when
   * the repo has none), the line commits it lacks (`behind`: what publishing
   * moves it over) and its commits the line lacks (`ahead`: publishing is a
   * fast-forward only at 0). Both 0 before the line is set up.
   */
  readonly published: {
    readonly commit: CommitId | null
    readonly behind: number
    readonly ahead: number
  }
  /**
   * Your `@-` against the line: the line commits it lacks, and the commits
   * of yours above the line when it descends from it (null when it does
   * not). `follow` is what updating your files would do (ADR-0061, S80):
   * how many files change, those that conflict, and your other heads that
   * move with `@`; null when nothing is behind, or `@` descends from no
   * line commit. `conflicts` are your conflicted commits above the line and
   * the conflicted files in `@`.
   */
  readonly yours: {
    readonly behind: number
    readonly ahead: number | null
    readonly follow: {
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
   * Whether this host accepts the `line` commands that act on the repo as its
   * owner (set up, land, update your files): only when it admits no one but
   * this machine (no invite key). Publishing is anyone's (ADR-0076).
   */
  readonly commands: boolean
}

/**
 * A thread's base as its lane's history says it (ADR-0060): a host-written
 * `pineta.base` value keyed by lane, a cache the page reads. `start` is the
 * commit the lane's newest `Pineta-Base` trailer names, or the line commit it
 * forked from when it has none.
 */
export interface BaseRecord {
  readonly lane: LaneName
  readonly base: ThreadBase
  readonly start: CommitId
  /** A WIP base: on the line now (landed), gone without landing, or neither. */
  readonly state: "ok" | "landed" | "gone"
  /**
   * What catching up would change, read at the lane's tip and the base's
   * commit then (S97); null when the base had not moved, or jj could not
   * say. A reader whose base has moved since reads it as unknown.
   */
  readonly catchUp: CatchUpRead | null
  /**
   * Integrated-offer commits of this thread on the line, above its base,
   * that name no source (`untracedLanes`, S97): nothing is offered until it
   * catches up past them.
   */
  readonly untraced: readonly CommitId[]
}

/** What catching up would change in a lane (`catchUpFiles`), and what it was read at. */
export interface CatchUpRead {
  readonly tip: CommitId
  /** The base's commit: the line's, or the WIP's. */
  readonly to: CommitId
  readonly files: readonly string[]
}

// --- cards (ADR-0048) --------------------------------------------------------

/**
 * A command a card is sent through (ADR-0055); a plain card has none. The
 * first two bring the thread up to date with its base, `continue-on-line`
 * moving a thread whose WIP is gone to the line first (ADR-0060);
 * `catch-up-with-parent` merges the thread it branched from (ADR-0072).
 */
export type CardCommand =
  | "bring-up-to-date"
  | "continue-on-line"
  | "catch-up-with-parent"
export const CARD_COMMANDS: readonly CardCommand[] = [
  "bring-up-to-date",
  "continue-on-line",
  "catch-up-with-parent",
]

/**
 * Where a card is. Drafting: below the line at a thread's end, kept as a send
 * carries it (where it started, and its column's lane) and resolved through
 * `threadOf` whenever it is needed, so it follows its thread as the thread
 * grows. Pinned: at the top of a thread's column, kept and resolved as a
 * drafting card is; the agent reads it on every run. Queued: above the line, waiting for its thread's lane, until the
 * host pops it or someone unqueues it. Fresh: an unsent branch or new tab,
 * by its column's key, in the root it will start or branch in. Inventory: in its holder's inventory; which slot holds
 * it is the holder's own document (`InventoryDoc`), not the host's (ADR-0059).
 */
export type CardPlace =
  | {
      readonly kind: "drafting"
      /** The root its thread is in (ADR-0063), with `at` a `Spot`. */
      readonly root: RootId
      readonly at: Position
      readonly lane: LaneName | null
    }
  | {
      readonly kind: "pinned"
      /** The root its thread is in (ADR-0063), with `at` a `Spot`. */
      readonly root: RootId
      readonly at: Position
      readonly lane: LaneName | null
      /** Sorts the thread's pinned cards, in the order they were pinned. */
      readonly order: string
    }
  | {
      readonly kind: "queued"
      /** Its lane's root (ADR-0063), with `at` a `Spot`. */
      readonly root: RootId
      /** Where it was queued: an unqueue puts it back here. */
      readonly at: Position
      readonly lane: LaneName
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
      readonly kind: "fresh"
      readonly column: string
      /**
       * The root its column is in (ADR-0063): a branch's tab's root, or the
       * root a new tab minted as it opened. The host reads a move's history
       * from it (`historyOf`).
       */
      readonly root: RootId
      /** Where its first send writes: the branch point, or the root for a new tab. */
      readonly at: Position
    }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/** How many cards an inventory holds: a fixed grid (ADR-0048). */
export const INVENTORY_SLOTS = 18
/** The inventory grid's width: 3 rows of 6. */
export const INVENTORY_COLUMNS = 6

/**
 * The card a chat is sent from, with its text's version as its sender had it
 * (`textVersion`): queued, the host pops it only once it holds that much
 * of the text (S96).
 */
export interface SentCard {
  readonly id: CardId
  readonly seen: string
}

type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Where a card is, without what the host assigns when it queues or pins one
 * (its order, and who queued it). A move compares it and targets it. A queued key
 * keeps its text's version (`seen`), which the queuer sends with the move
 * (S96).
 */
export type PlaceKey = OmitEach<CardPlace, "order" | "by">

export function keyOf(place: CardPlace): PlaceKey {
  switch (place.kind) {
    case "drafting":
      return place
    case "pinned":
      return {
        kind: "pinned",
        root: place.root,
        at: place.at,
        lane: place.lane,
      }
    case "queued":
      return {
        kind: "queued",
        root: place.root,
        at: place.at,
        lane: place.lane,
        seen: place.seen,
      }
    case "fresh":
    case "inventory":
      return place
  }
}

/**
 * Whether two keys name one place. A queue's or the pinned cards' order is
 * not part of a key, so a reorder does not make someone else's move fail.
 */
export function sameKey(a: PlaceKey, b: PlaceKey): boolean {
  switch (a.kind) {
    case "drafting":
      return (
        b.kind === "drafting" && samePosition(a.at, b.at) && a.lane === b.lane
      )
    case "pinned":
      return (
        b.kind === "pinned" && samePosition(a.at, b.at) && a.lane === b.lane
      )
    case "queued":
      return (
        b.kind === "queued" && samePosition(a.at, b.at) && a.lane === b.lane
      )
    // A column's key names it, wherever it is.
    case "fresh":
      return b.kind === "fresh" && a.column === b.column
    case "inventory":
      return b.kind === "inventory" && a.holder === b.holder
  }
}

/** Which way an undo of moves goes. */
export type MoveDirection = "undo" | "redo"
export const MOVE_DIRECTIONS: readonly MoveDirection[] = ["undo", "redo"]

/**
 * A handoff (ADR-0059): move a card from where its sender saw it to another
 * place. `from` null creates the card; `to` null removes it.
 */
export interface Move {
  readonly card: CardId
  readonly from: PlaceKey | null
  readonly to: PlaceKey | null
}

/** `card`'s move from where it is now to `to`; `to` null removes it. */
export const moveOf = (card: CardRecord, to: PlaceKey | null): Move => ({
  card: card.id,
  from: keyOf(card.place),
  to,
})

/**
 * Where an unqueue or an unpin puts a card: drafting where it was queued or
 * pinned.
 */
export const draftingOf = (
  place: Extract<CardPlace, { kind: "queued" | "pinned" }>,
): PlaceKey => ({
  kind: "drafting",
  root: place.root,
  at: place.at,
  lane: place.lane,
})

/**
 * Where a pin puts a card below the line: pinned at the same thread end.
 * Null for any other place: a fresh column has no thread to pin it to yet.
 */
export const pinnedOf = (place: CardPlace | PlaceKey): PlaceKey | null =>
  place.kind === "drafting"
    ? { kind: "pinned", root: place.root, at: place.at, lane: place.lane }
    : null

/**
 * The root a card queued on `lane` belongs to: its lane's, since the host
 * pops it into a chat there (ADR-0063); else, for a lane with no record yet, the
 * root the card drafts or queues in. Undefined for a card at no thread.
 */
export function queueRoot(
  lane: LaneName,
  card: CardRecord,
  lanes: ReadonlyMap<LaneName, LaneRecord>,
): RootId | undefined {
  const own =
    card.place.kind === "drafting" || card.place.kind === "queued"
      ? card.place.root
      : undefined
  return lanes.get(lane)?.root ?? own
}

/** Why the host refused a move (ADR-0059). */
export type MoveRefusal =
  /** The card is no longer where the sender saw it. */
  | "moved"
  /** The card has no record: sent, or discarded. */
  | "gone"
  /** A creation whose id is in use. */
  | "exists"
  /** A removal of a card in neither a fresh column nor the sender's inventory. */
  | "not-fresh"
  /** The sender's inventory holds `INVENTORY_SLOTS` cards already. */
  | "full"
  /** A move into or out of someone else's inventory. */
  | "not-yours"

/**
 * A place as flat strings, "" for none: how the places document stores it,
 * and how the wire carries a key. `placeFields` writes this shape, and
 * `placeOfFields` and `keyOfFields` read it.
 */
export interface PlaceFields {
  readonly kind: string
  /** A drafting, pinned, queued or fresh card's root (ADR-0063); "" for an inventory's. */
  readonly root: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly holder: string
}

const entryOrEmpty = (at: Position): string => (at.kind === "root" ? "" : at.id)

/** A place (or a key, whose `order` and `by` are "") as flat strings. */
export function placeFields(place: CardPlace | PlaceKey): PlaceFields {
  switch (place.kind) {
    case "drafting":
      return {
        kind: "drafting",
        root: place.root,
        at: entryOrEmpty(place.at),
        lane: place.lane ?? "",
        column: "",
        order: "",
        by: "",
        seen: "",
        holder: "",
      }
    case "pinned":
      return {
        kind: "pinned",
        root: place.root,
        at: entryOrEmpty(place.at),
        lane: place.lane ?? "",
        column: "",
        order: "order" in place ? place.order : "",
        by: "",
        seen: "",
        holder: "",
      }
    case "queued":
      return {
        kind: "queued",
        root: place.root,
        at: entryOrEmpty(place.at),
        lane: place.lane,
        column: "",
        order: "order" in place ? place.order : "",
        by: "by" in place ? place.by : "",
        seen: place.seen,
        holder: "",
      }
    case "fresh":
      return {
        kind: "fresh",
        root: place.root,
        at: entryOrEmpty(place.at),
        lane: "",
        column: place.column,
        order: "",
        by: "",
        seen: "",
        holder: "",
      }
    case "inventory":
      return {
        kind: "inventory",
        root: "",
        at: "",
        lane: "",
        column: "",
        order: "",
        by: "",
        seen: "",
        holder: place.holder,
      }
  }
}

/**
 * Flat strings -> a place; undefined for one that is malformed. A drafting
 * or queued card's `at` is an entry, never the root; a fresh card's `at` is
 * either. Every card in a root needs its `RootId`. A fresh card's column is
 * never "", nor an inventory card's holder. A drafting card whose lane is
 * not a thread's keeps its place with no lane: dropped, its text would be
 * swept at the next start, and the lane only says which thread it follows.
 * A pinned card is read as a drafting one, and needs its order. A queued
 * card needs its lane, its order and who queued it.
 */
export function placeOfFields(f: PlaceFields): CardPlace | undefined {
  switch (f.kind) {
    case "fresh":
      return f.column === "" || !isRootId(f.root)
        ? undefined
        : {
            kind: "fresh",
            column: f.column,
            root: f.root,
            at: f.at === "" ? ROOT : atEntry(entryId(f.at)),
          }
    case "inventory":
      return f.holder === ""
        ? undefined
        : { kind: "inventory", holder: f.holder as WriterId }
    case "drafting":
      return f.at === "" || !isRootId(f.root)
        ? undefined
        : {
            kind: "drafting",
            root: f.root,
            at: atEntry(entryId(f.at)),
            lane: isLaneName(f.lane) ? f.lane : null,
          }
    case "pinned":
      return f.at === "" || !isRootId(f.root) || f.order === ""
        ? undefined
        : {
            kind: "pinned",
            root: f.root,
            at: atEntry(entryId(f.at)),
            lane: isLaneName(f.lane) ? f.lane : null,
            order: f.order,
          }
    case "queued":
      return f.at === "" ||
        !isRootId(f.root) ||
        !isLaneName(f.lane) ||
        f.order === "" ||
        f.by === ""
        ? undefined
        : {
            kind: "queued",
            root: f.root,
            at: atEntry(entryId(f.at)),
            lane: f.lane,
            order: f.order,
            by: f.by as WriterId,
            seen: f.seen,
          }
    default:
      return undefined
  }
}

/**
 * Flat strings -> a key, as a move names one; undefined for one that is
 * malformed. A queued key has no order and no queuer, and keeps its text's
 * version; a pinned key has no order.
 */
export function keyOfFields(f: PlaceFields): PlaceKey | undefined {
  if (f.kind === "pinned")
    return f.at === "" || !isRootId(f.root)
      ? undefined
      : {
          kind: "pinned",
          root: f.root,
          at: atEntry(entryId(f.at)),
          lane: isLaneName(f.lane) ? f.lane : null,
        }
  if (f.kind !== "queued") return placeOfFields(f)
  return f.at === "" || !isRootId(f.root) || !isLaneName(f.lane)
    ? undefined
    : {
        kind: "queued",
        root: f.root,
        at: atEntry(entryId(f.at)),
        lane: f.lane,
        seen: f.seen,
      }
}

/**
 * A card's record, in the places document, which only the host writes
 * (ADR-0059). Its text is its own document; who wrote in it is read from
 * that document's operations (`writersOfClients`), never stored here.
 */
export interface CardRecord {
  readonly id: CardId
  /** Who created it: whose composer it is. */
  readonly owner: WriterId
  readonly place: CardPlace
  /**
   * Who put it where it is: the sender of the last move the host accepted.
   * A write the host makes itself (a popped card written back when refused)
   * keeps it.
   * When someone else moves the card, the trace is for them (ADR-0048).
   */
  readonly placer: WriterId
  /** What it is sent through when popped (ADR-0055); null for a plain message. */
  readonly command: CardCommand | null
  /** Why the host could not send it, until it is queued again; null when it never failed. */
  readonly unsent: string | null
}

/**
 * One change to a living card's place (ADR-0048 step 6): who made it, from
 * where to where, and when. What the change was called (queued, took into
 * the inventory, pinned) is read from the two places when it is worded (`verbOf`).
 */
export interface CardEvent {
  readonly kind:
    | "created"
    | "moved"
    | "undone"
    | "redone"
    | "unsent"
    | "followed"
  /** Who made it; null for the host's own write. */
  readonly by: WriterId | null
  readonly from: PlaceKey | null
  readonly to: PlaceKey
  readonly at: number
}

/**
 * A card's history: a host-written `pineta.card-history` value in the
 * session, keyed by the card, and deleted with it.
 */
export interface CardHistoryRecord {
  readonly card: CardId
  /** Oldest first; at most `HISTORY_EVENTS`, the first always kept. */
  readonly events: readonly CardEvent[]
}

/**
 * What stays where your card was when someone else moved it, while you were
 * not looking (ADR-0048, *Other people*): a host-written `pineta.trace`
 * value in the session, keyed by its own id, since it outlives its card.
 * Drawn only for its placer, and deleted once they have seen it.
 */
export interface TraceRecord {
  readonly id: string
  /** The card's placer before it moved: the one person it is drawn for. */
  readonly for: WriterId
  readonly card: CardId
  readonly by: WriterId
  readonly from: PlaceKey
  /** Where the card went; null when it was sent. */
  readonly to: PlaceKey | null
  /** The message a send wrote; null for any other move. */
  readonly message: EntryId | null
  readonly at: number
}

/**
 * A seat the host has seen: its Kyneta peer, the Yjs `clientID` its
 * operations carry, and the person it is (ADR-0037). A host-written
 * `pineta.seat` value keyed by the peer, so anyone can name who wrote in a
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
 * Every `@handle` in `text`, in order, without repeats. `@agent` is the agent;
 * any other handle is a person. A handle starts a word, so an e-mail address is
 * not a mention.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  const pattern = new RegExp(
    `(?<![${HANDLE_CHARS}@])@([${HANDLE_CHARS}]+)`,
    "gu",
  )
  for (const [, handle] of text.matchAll(pattern)) {
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

/** Who a message is for. */
export interface Address {
  /** The agent, if it must answer: a run. */
  readonly compels: Responder
  /** Participants the message names, by display name. Never compelled. */
  readonly people: readonly string[]
}

/**
 * Who a message is for (ADR-0021). `@agent` compels the agent. Otherwise a
 * message naming participants is for them, and the agent is left out.
 * Otherwise the thread decides: the agent where it is the default (a thread
 * with a lane, or a Start Agent column), nobody where it is not.
 *
 * A handle that names no participant is ignored, so `@types/node` in agent
 * work still asks the agent. Pure; the composer and the host both call it.
 */
export function address(input: {
  readonly mentions: readonly Mention[]
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  readonly agentByDefault: boolean
}): Address {
  const byHandle = new Map(input.participants.map(n => [handleOf(n), n]))
  const people = input.mentions.flatMap(m =>
    m.kind === "person" ? [byHandle.get(handleOf(m.name))].filter(isName) : [],
  )
  const agent = input.mentions.find(m => m.kind === "agent")
  const compels: Responder =
    agent !== undefined
      ? { kind: "agent", agent: agent.agent }
      : people.length > 0 || !input.agentByDefault
        ? NOBODY
        : { kind: "agent", agent: THE_AGENT }
  return { compels, people }
}

const isName = (n: string | undefined): n is string => n !== undefined

/** A display name's longest form, in UTF-16 code units. */
export const MAX_NAME_LENGTH = 40

/**
 * A display name as typed -> the stored one, or undefined if unusable: empty,
 * too long, or one no mention could reach (no letter or digit, or spelled
 * `@agent`, which is always the agent).
 */
export function normalizeName(name: string): string | undefined {
  const n = name.trim()
  const handle = handleOf(n)
  return n.length === 0 ||
    n.length > MAX_NAME_LENGTH ||
    handle === "" ||
    handle === THE_AGENT
    ? undefined
    : n
}

// --- streams ----------------------------------------------------------------

/**
 * What a running turn streams, in Pineta's own words (ADR-0003: no pi type
 * crosses). `packages/pi` maps pi's harness events onto it; `planStream` in
 * `@pineta/schema` decides what each does to the document. There is no end
 * event: a stream stays until the entry that replaces it is written.
 */
export type StreamEvent =
  /** Text the model is writing, as a delta. */
  | { readonly kind: "text"; readonly lane: LaneName; readonly delta: string }
  | {
      readonly kind: "toolStart"
      readonly lane: LaneName
      readonly callId: string
    }
  /** The tool's output so far: a whole snapshot, not a delta. */
  | {
      readonly kind: "toolOutput"
      readonly lane: LaneName
      readonly callId: string
      readonly text: string
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
 * with no error. Contrast `LaneName`, where creation IS the danger (a writer's
 * id or "main" used as a lane, ADR-0020) and the brand therefore does real
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

export * from "./asks.ts"
export * from "./edits.ts"
export * from "./images.ts"
export * from "./offers.ts"
export * from "./presence.ts"
export * from "./roots.ts"
export * from "./tools.ts"
export * from "./trailers.ts"
export * from "./tree.ts"
export * from "./work.ts"
