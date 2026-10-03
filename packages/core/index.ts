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

import type { Sha256 } from "./images.ts"

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
 * in the codec, the schema's readers, marginalia's decoders and the pi adapter.
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

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Positions take an entry id; `activeRuns` holds run ids. Passing
 * one where the other belongs would otherwise compile, run, and fail
 * silently. Mint them only where they enter: the protocol codec, the reads,
 * the schema's readers, marginalia's decoders, the pi adapter, the client's
 * stored forms, and the host's id generator. `biome.json` refuses an
 * `entryId` import in core, the client and the host, and a `runId` import in
 * core and the client (S71).
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
  LANE_TAKEN: "lane_taken",
  /**
   * A command that acts on the repo as its owner (set up the line, land your
   * work) from a host that admits others: it has an invite key (ADR-0060).
   */
  NOT_YOURS: "not_yours",
  /** An offer taken, or work landed, before the line is set up (ADR-0060). */
  NO_LINE: "no_line",
  /** A take to a bookmark that is not one of the offer's destinations now. */
  BAD_DESTINATION: "bad_destination",
  /** A new thread's base that is not a WIP bookmark above the line. */
  BAD_BASE: "bad_base",
  /** Bringing a thread up to date with a WIP bookmark that is gone (ADR-0060). */
  BASE_GONE: "base_gone",
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
 * card it takes (ADR-0048). The lane's queue has already decided that card's
 * turn, so only a run makes the lane busy, and a race does not count. A
 * client never sends it: it queues a card instead.
 */
export type PlanMode = ChatMode | "queue"

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule, so this type cannot express a
 * malformed command. What it then does is decided by `planChat` and the
 * other planners in `@pineta/marginalia`, over what the host gathers.
 */
export type Intent =
  /** A human message; `mentions` are parsed from `text` once, at the codec. */
  | {
      readonly kind: "chat"
      readonly text: string
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
  /** Hide a root for everyone, or bring it back (ADR-0029). */
  | {
      readonly kind: "archive"
      readonly action: ArchiveAction
      readonly root: EntryId
    }
  /** Title an entry, or clear its title with null (ADR-0045). */
  | {
      readonly kind: "mark"
      readonly entry: EntryId
      readonly title: string | null
    }
  /**
   * Act on a lane's offer in your repo (ADR-0038). A take names its
   * destination bookmark, null for the default (ADR-0060).
   */
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
    }
  /** Set up the integration line, or land your work on it (ADR-0060). */
  | { readonly kind: "line"; readonly action: LineAction }
  /** Move a card, create one, or remove one (ADR-0059). */
  | { readonly kind: "move"; readonly move: Move }
  /** Set a card's command, or clear it with null (ADR-0055). */
  | {
      readonly kind: "set-command"
      readonly card: CardId
      readonly command: CardCommand | null
    }

/**
 * What can be done with an offer: take it into your repo, have the agent split
 * it into a stack, squash a stack back to one revision, have the agent write
 * its description again, or rebuild it, discarding your edits (ADR-0038).
 */
export type OfferAction = "take" | "split" | "squash" | "describe" | "refresh"
export const OFFER_ACTIONS: readonly OfferAction[] = [
  "take",
  "split",
  "squash",
  "describe",
  "refresh",
]

/**
 * What can be done with the integration line (ADR-0060): set it up at your
 * `@-`, writing your repo's immutable heads, or land your work on it.
 */
export type LineAction = "setup" | "land" | "follow"
export const LINE_ACTIONS: readonly LineAction[] = ["setup", "land", "follow"]

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

// --- marks (ADR-0045) --------------------------------------------------------

/**
 * A title on an entry: a host-written `pineta.mark` value keyed by the
 * entry's id, so an entry has at most one. A root's mark titles its tab.
 */
export interface MarkRecord {
  readonly entry: EntryId
  readonly title: string
  readonly by: WriterId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

// --- stops (ADR-0056) --------------------------------------------------------

/**
 * Who stopped an ask's run: a host-written `pineta.stop` value keyed by the
 * ask's prompt. pi's entries say a run was aborted, never by whom (S70).
 */
export interface StopRecord {
  readonly by: WriterId
  /** When Stop was pressed, in ms since the epoch. */
  readonly at: number
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
 * What a revision's evolog says since the host's newest version of it
 * (`readOffer` in `@pineta/lanes` reads it, `revisionEdited` in
 * `@pineta/marginalia` decides from it): whether the walk back reached a
 * version the host made, and whether a version an operation not the host's
 * made on the way changed it. Read from the repo, never from a record the
 * host kept, which can be lost after its jj steps landed (S73).
 */
export interface RevisionFacts {
  readonly reached: boolean
  readonly yoursChanged: boolean
}

/** One revision of an offer, as your repo holds it now. */
export interface OfferRevision {
  readonly commit: CommitId
  /** Its change id: what jj steps on it name (S48 item 2). */
  readonly change: string
  readonly since: RevisionFacts
}

/** An offer's ledger, as its top's message carries it (`offerLedger`). */
export interface OfferLedger {
  /** The lane tip it holds (`Pineta-Source`). */
  readonly source: CommitId
  /** Where it starts (`Pineta-Start`). */
  readonly start: readonly CommitId[]
}

/**
 * An offer as your repo holds it now (`readOffer` in `@pineta/lanes`): all
 * the host decides an offer from. Facts only; what they mean is decided in
 * `@pineta/marginalia` (`planRefresh`, `offerEdited`, `offerMoved`,
 * `isWipLine`). A divergent offer is only its change ids: the repair needs
 * nothing more, and every other read would name one of two commits.
 */
export type OfferInRepo =
  | {
      readonly kind: "offer"
      /** Bottom first. */
      readonly revisions: readonly OfferRevision[]
      /** Each revision's parent is the one below it: no commit of yours between. */
      readonly chained: boolean
      readonly ledger: OfferLedger | null
      /** The top's first line. */
      readonly firstLine: string
      /** The bottom's parent is an ancestor of the target (S48 item 7). */
      readonly placed: boolean
      /** The bottom's parents are exactly the target. */
      readonly onTarget: boolean
      readonly files: readonly string[]
      /** Files conflicting in its top: with the work under it (S48 item 3). */
      readonly conflicts: readonly string[]
    }
  | { readonly kind: "divergent"; readonly changes: readonly string[] }

/**
 * The trailers the host writes into commit messages: a turn names its entry
 * and lane (ADR-0032), an offer its thread too (ADR-0039). The ledger
 * (ADR-0060): a lane's start or update names its base, `<bookmark>@<commit>`;
 * an offer names the lane tip it holds and where it starts.
 */
export const TRAILERS = {
  thread: "Pineta-Thread",
  lane: "Pineta-Lane",
  entry: "Pineta-Entry",
  base: "Pineta-Base",
  source: "Pineta-Source",
  start: "Pineta-Start",
} as const

/**
 * Every value of trailer `key` in a message, from every paragraph, in order.
 * A squash of two commits keeps both messages, so a message can hold two
 * trailer paragraphs; jj's `trailers` template reads only the last (S77).
 */
export function trailerValues(
  message: string,
  key: (typeof TRAILERS)[keyof typeof TRAILERS],
): string[] {
  const prefix = `${key}: `
  return message
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length).trim())
    .filter(v => v !== "")
}

/**
 * An offer's ledger as its message carries it (ADR-0060): the lane tip it
 * holds (`Pineta-Source`) and where it starts (`Pineta-Start`), from the
 * last paragraph that names a source, so a message holding an older ledger
 * above it reads as the newest. Null when no paragraph names one, as after
 * you rewrote the message without them.
 */
export function offerLedger(message: string): OfferLedger | null {
  const paragraph = message
    .split("\n\n")
    .filter(p => trailerValues(p, TRAILERS.source).length > 0)
    .at(-1)
  if (paragraph === undefined) return null
  const source = trailerValues(paragraph, TRAILERS.source).at(-1)
  const start = trailerValues(paragraph, TRAILERS.start)
  if (source === undefined || start.length === 0) return null
  return { source: commitId(source), start: start.map(commitId) }
}

/**
 * Where a thread's lane starts and is brought up to date from (ADR-0060):
 * the integration line, or a WIP bookmark you chose at its first message.
 */
export type ThreadBase =
  | { readonly kind: "line" }
  | { readonly kind: "wip"; readonly bookmark: string }

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
  readonly work: WorkSetting
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
 * host's steps (`offerRecord`). The host never decides from it: it reads the
 * offer from your repo (`OfferInRepo`), so a record lost or stale changes
 * nothing. What a take would
 * bring, each revision's description, files and diffs, is not stored: the page
 * reads it by commit when it asks (`RevisionReview`, ADR-0047).
 */
export interface OfferRecord {
  readonly lane: LaneName
  /** Its revisions: 1 for a single offer, more for a stack. */
  readonly size: number
  /** The lane turned since the stack was made: it no longer holds all of it. */
  readonly stale: boolean
  readonly files: readonly string[]
  /** Files that conflict with your committed work (S48 item 3). */
  readonly conflicts: readonly string[]
  /** Files it touches that you are editing in `@` (S48 item 4). */
  readonly yourEdits: readonly string[]
  /** An agent wrote its description; false while it carries the placeholder. */
  readonly described: boolean
  /** You edited it since the host last wrote it: the host leaves it alone. */
  readonly edited: boolean
  /** Its bookmark in your repo, as jjui shows it. */
  readonly bookmark: string
  /** The change id its top became when you took it; null while it is open. */
  readonly taken: string | null
  /**
   * Each revision's commit as the host last read it, bottom first: what a
   * review may read. It follows a rebase jj made under the offer, and your
   * edits.
   */
  readonly commits: readonly CommitId[]
  readonly at: number
}

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

declare const threadNameBrand: unique symbol
/**
 * A thread's name as people say it: two words, `amber-fox` (ADR-0039). Minted
 * by `@pineta/marginalia`'s naming and its decoder; stored, never recomputed.
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
   * Your `@-` against the line: the line commits it lacks, and the commits
   * of yours above the line when it descends from it (null when it does
   * not). `follow` is what updating your files would do (ADR-0061, S80):
   * the files that change, those that conflict, and your other heads that
   * move with `@`; null when nothing is behind, or `@` descends from no
   * line commit. `conflicts` are your conflicted commits above the line and
   * the conflicted files in `@`.
   */
  readonly yours: {
    readonly behind: number
    readonly ahead: number | null
    readonly follow: {
      readonly files: readonly string[]
      readonly conflicts: readonly string[]
      readonly heads: number
    } | null
    readonly conflicts: {
      readonly commits: number
      readonly files: readonly string[]
    }
  }
  /**
   * Whether this host takes `line` commands (set up, land): only when it
   * admits no one but this machine (no invite key), since they act on the
   * repo as its owner.
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
}

// --- cards (ADR-0048) --------------------------------------------------------

/**
 * A command a card is sent through (ADR-0055); a plain card has none. Both
 * bring the thread up to date with its base; `continue-on-line` moves a
 * thread whose WIP is gone to the line first (ADR-0060).
 */
export type CardCommand = "bring-up-to-date" | "continue-on-line"
export const CARD_COMMANDS: readonly CardCommand[] = [
  "bring-up-to-date",
  "continue-on-line",
]

/**
 * Where a card is. Drafting: below the line at a thread's end, kept as a send
 * carries it (where it started, and its column's lane) and resolved through
 * `threadOf` whenever it is needed, so it follows its thread as the thread
 * grows. Queued: above the line, waiting for its thread's lane, until the
 * host takes it or someone unqueues it. Fresh: an unsent branch or new tab,
 * by its column's key. Inventory: in its holder's inventory; which slot holds
 * it is the holder's own document (`InventoryDoc`), not the host's (ADR-0059).
 */
export type CardPlace =
  | {
      readonly kind: "drafting"
      readonly at: Position
      readonly lane: LaneName | null
    }
  | {
      readonly kind: "queued"
      /** Where it was queued: an unqueue puts it back here. */
      readonly at: Position
      readonly lane: LaneName
      /** Sorts the lane's queue; ties go by id (S69). */
      readonly order: string
      /** Who queued it: its message's author. */
      readonly by: WriterId
      /**
       * The text's version as its queuer had it (`textVersion`), "" for none:
       * the host takes the card only once it holds that much (S72).
       */
      readonly seen: string
    }
  | { readonly kind: "fresh"; readonly column: string }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/** How many cards an inventory holds: a fixed grid (ADR-0048). */
export const INVENTORY_SLOTS = 18
/** The inventory grid's width: 3 rows of 6. */
export const INVENTORY_COLUMNS = 6

/**
 * The card a chat is sent from, with its text's version as its sender had it
 * (`textVersion`): queued, the host takes it only once it holds that much
 * of the text (S72).
 */
export interface SentCard {
  readonly id: CardId
  readonly seen: string
}

type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Where a card is, without what the host assigns when it queues one (its
 * order and who queued it). A move compares it and targets it. A queued key
 * keeps its text's version (`seen`), which the queuer sends with the move
 * (S72).
 */
export type PlaceKey = OmitEach<CardPlace, "order" | "by">

export function keyOf(place: CardPlace): PlaceKey {
  switch (place.kind) {
    case "drafting":
      return place
    case "queued":
      return {
        kind: "queued",
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
 * Whether two keys name one place. A queue's order is not part of a key, so
 * a reorder does not make someone else's unqueue fail.
 */
export function sameKey(a: PlaceKey, b: PlaceKey): boolean {
  switch (a.kind) {
    case "drafting":
      return (
        b.kind === "drafting" && samePosition(a.at, b.at) && a.lane === b.lane
      )
    case "queued":
      return (
        b.kind === "queued" && samePosition(a.at, b.at) && a.lane === b.lane
      )
    case "fresh":
      return b.kind === "fresh" && a.column === b.column
    case "inventory":
      return b.kind === "inventory" && a.holder === b.holder
  }
}

/**
 * A handoff (ADR-0059): move a card from where its sender saw it to another
 * place. `from` null creates the card; `to` null removes it.
 */
export interface Move {
  readonly card: CardId
  readonly from: PlaceKey | null
  readonly to: PlaceKey | null
}

/** Why the host refused a move (ADR-0059). */
export type MoveRefusal =
  /** The card is no longer where the sender saw it. */
  | "moved"
  /** The card has no record: sent, or discarded. */
  | "gone"
  /** A creation whose id is taken. */
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
        at: entryOrEmpty(place.at),
        lane: place.lane ?? "",
        column: "",
        order: "",
        by: "",
        seen: "",
        holder: "",
      }
    case "queued":
      return {
        kind: "queued",
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
        at: "",
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
 * or queued card's `at` is an entry, never the root, and a fresh card's
 * column is never "", nor an inventory card's holder. A drafting card whose lane is not a thread's keeps its
 * place with no lane: dropped, its text would be swept at the next start,
 * and the lane only says which thread it follows. A queued card needs its
 * lane, its order and who queued it.
 */
export function placeOfFields(f: PlaceFields): CardPlace | undefined {
  switch (f.kind) {
    case "fresh":
      return f.column === "" ? undefined : { kind: "fresh", column: f.column }
    case "inventory":
      return f.holder === ""
        ? undefined
        : { kind: "inventory", holder: f.holder as WriterId }
    case "drafting":
      return f.at === ""
        ? undefined
        : {
            kind: "drafting",
            at: atEntry(entryId(f.at)),
            lane: isLaneName(f.lane) ? f.lane : null,
          }
    case "queued":
      return f.at === "" || !isLaneName(f.lane) || f.order === "" || f.by === ""
        ? undefined
        : {
            kind: "queued",
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
 * version.
 */
export function keyOfFields(f: PlaceFields): PlaceKey | undefined {
  if (f.kind !== "queued") return placeOfFields(f)
  return f.at === "" || !isLaneName(f.lane)
    ? undefined
    : {
        kind: "queued",
        at: atEntry(entryId(f.at)),
        lane: f.lane,
        seen: f.seen,
      }
}

/**
 * A card's record, in the places document, which only the host writes
 * (ADR-0059). Its text is its own document; who wrote in it is read from
 * that document's operations (`writersOf`), never stored here.
 */
export interface CardRecord {
  readonly id: CardId
  /** Who created it: whose composer it is. */
  readonly owner: WriterId
  readonly place: CardPlace
  /**
   * Who put it where it is: the sender of the last move the host accepted.
   * A write the host makes itself (a refused take written back) keeps it.
   */
  readonly placer: WriterId
  /** What it is sent through when taken (ADR-0055); null for a plain message. */
  readonly command: CardCommand | null
  /** Why the host could not send it, until it is queued again; null when it never failed. */
  readonly unsent: string | null
}

/**
 * A seat the host has seen: the Yjs `clientID` its operations carry, and the
 * person it is (ADR-0037). A host-written `pineta.seat` value, so anyone can
 * name who wrote in a text after the seat has gone.
 */
export interface SeatRecord {
  readonly clientId: number
  readonly writer: WriterId
  /** When the host first saw it, which orders contributors. */
  readonly at: number
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
export * from "./presence.ts"
export * from "./roots.ts"
export * from "./tools.ts"
export * from "./tree.ts"
export * from "./work.ts"
