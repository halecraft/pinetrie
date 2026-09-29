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
 * A thread's lane: a line of work (ADR-0019), created where agent work is first
 * wanted in a thread and never moved (ADR-0020). Only `laneNameForThread()`
 * can mint one, so no writer's id or `"main"` is assignable.
 */
export type LaneName = string & { readonly [laneNameBrand]: true }

const LANE_PREFIX = "t-"

/** A new thread lane's name, from a fresh coordination-free id. */
export const laneNameForThread = (id: string): LaneName =>
  `${LANE_PREFIX}${id}` as LaneName

/** Whether untrusted text names a thread's lane: the codec's check. */
export const isLaneName = (s: string): s is LaneName =>
  s.startsWith(LANE_PREFIX) && s.length > LANE_PREFIX.length

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
declare const referenceIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Positions take an entry id; `activeRuns` holds run ids. Passing
 * one where the other belongs would otherwise
 * compile, run, and fail silently. Mint them only at the edges: the protocol
 * codec, the document readers, and the host's id generator.
 */
export type EntryId = string & { readonly [entryIdBrand]: true }
export type RunId = string & { readonly [runIdBrand]: true }
export const entryId = (id: string): EntryId => id as EntryId
export const runId = (id: string): RunId => id as RunId
/** A reference's id: the key of its stored value, so it must be unique (ADR-0016). */
export type ReferenceId = string & { readonly [referenceIdBrand]: true }
export const referenceId = (id: string): ReferenceId => id as ReferenceId
declare const noteIdBrand: unique symbol
/** A note's id, uuidv7: the key of its record and the name of its text's document. */
export type NoteId = string & { readonly [noteIdBrand]: true }
export const noteId = (id: string): NoteId => id as NoteId

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
   * The root is no entry: a reference cannot attach there, and a `reply` or
   * `queue` has nothing to continue. Only a `branch` starts a thread at it.
   */
  NO_ANCHOR: "no_anchor",
  /** A span is empty, out of bounds, or on an entry with no text. */
  INVALID_SPAN: "invalid_span",
  /** A display name is empty or too long. */
  INVALID_NAME: "invalid_name",
  /** A note action its note's state does not allow: sending a note that is no draft. */
  NOTE_STATE: "note_state",
  /** A write in a root someone archived (ADR-0029). The message names them. */
  ARCHIVED: "archived",
  /** Archiving a root where the agent is working or messages are waiting. */
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
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

/** What a reference points at. Spans are UTF-16 code units into `entryText`. */
export type ReferenceTarget =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "span"
      readonly id: EntryId
      readonly start: number
      readonly end: number
    }

/**
 * How a message means to join the tree.
 *
 * - `reply`: continue the thread I am reading; I saw it end at `at`. If
 *   another writer compelled the agent there since, that is a race, and the
 *   sender is told (`conflict`) rather than guessed for.
 * - `queue`: add this to the agent's work in this thread, whenever it is free.
 * - `branch`: start a thread at `at`, the root or any message. Every thread
 *   starts this way, and a branch never continues an existing lane: a
 *   compelled one is a new line of work (ADR-0021).
 */
export type ChatMode = "reply" | "queue" | "branch"
export const CHAT_MODES: readonly ChatMode[] = ["reply", "queue", "branch"]

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule, so this type cannot express a
 * malformed command. What it then does is decided by `planChat` and
 * `planReference` in `@pineta/marginalia`, over what the host gathers.
 */
export type Intent =
  /** A citation, attached where its author is reading (`at`). */
  | {
      readonly kind: "reference"
      readonly to: ReferenceTarget
      readonly at: Position
    }
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
    }
  /** Set the sender's display name: a label, never an identity. */
  | { readonly kind: "name"; readonly name: string }
  /** End a thread's running turn. Idempotent: an idle lane is already stopped. */
  | { readonly kind: "stop"; readonly lane: LaneName }
  /** Open a message for editing, draft a thread's next one, or move a note on. */
  | { readonly kind: "note"; readonly action: NoteAction }
  /** Hide a root for everyone, or bring it back (ADR-0029). */
  | {
      readonly kind: "archive"
      readonly action: ArchiveAction
      readonly root: EntryId
    }
  /**
   * Merge your work into a lane: a fact in the thread when it merges cleanly,
   * the resolution run when it conflicts (ADR-0038, ADR-0033).
   */
  | { readonly kind: "update"; readonly lane: LaneName }
  /** Act on a lane's offer in your repo (ADR-0038). */
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
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
/** The project's disk at your `@-`, which root lanes fork from. */
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
 * keyed by lane. The page reads the top-level fields; `host` is what the host
 * remembers of what it wrote, and nothing else reads it.
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
  readonly at: number
  readonly host: {
    /** Each revision's change id, bottom first: its identity across rewrites. */
    readonly changes: readonly string[]
    /** The commit the host last wrote for each, bottom first. */
    readonly wrote: readonly CommitId[]
    /** The lane commit it was built from. */
    readonly tip: CommitId
    /** Where it started when built or last followed: what it holds is the tip's change since. */
    readonly start: readonly CommitId[]
  }
}

/** Your working copy as the host snapshotted it: `@`, and `@`'s parents. */
export interface YoursNow {
  readonly at: CommitId
  readonly parents: readonly CommitId[]
}

/** What a fork starts on: a commit a lane recorded, or a copy of your `@`. */
export type ForkStart =
  | { readonly kind: "commits"; readonly commits: readonly CommitId[] }
  | ({ readonly kind: "copy" } & YoursNow)

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
 * A commit you already have, though your repo holds it only as lane history:
 * a lane commit a take delivered, or a copy of your `@` made in a lane at a
 * fork or an update. A host-written `pineta.have` value keyed by commit.
 * Where an offer starts is read from these (ADR-0038).
 */
export interface HaveRecord {
  readonly lane: LaneName
  readonly commit: CommitId
  readonly kind: "delivered" | "copy"
  readonly at: number
}

// --- notes (ADR-0025) --------------------------------------------------------

/**
 * What a `note` command asks. A draft is started where its sender reads, with
 * their column's lane, exactly as a reply would be sent from there, and may
 * carry what they had already typed.
 */
export type NoteAction =
  | { readonly kind: "open"; readonly entry: EntryId }
  | {
      readonly kind: "draft"
      readonly at: Position
      readonly lane: LaneName | null
      readonly text: string
    }
  | { readonly kind: "done" | "reopen" | "send"; readonly note: NoteId }

export const NOTE_ACTIONS = ["open", "draft", "done", "reopen", "send"] as const

/** Draft: not yet sent. Open: being edited. Done: read-only until reopened. */
export type NoteState = "draft" | "open" | "done"

/**
 * What a note is the text of. An opened message's entry; a draft's place,
 * kept as a send carries it and resolved by `threadOf` whenever it is needed,
 * so it follows its thread as the thread grows; or, once a draft is sent, the
 * send that wrote its message, which the tree finds by `bySend` even while the
 * message waits in a lane's outbox.
 */
export type NoteSubject =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "draft"
      readonly at: Position
      readonly lane: LaneName | null
    }
  | { readonly kind: "sent"; readonly sendId: string }

/** A note's record: a host-written `pineta.note` value. Its text is its own document. */
export interface NoteRecord {
  readonly id: NoteId
  readonly state: NoteState
  readonly subject: NoteSubject
  readonly openedBy: WriterId
  /** Writers whose edits are in its text, in order of first edit. */
  readonly contributors: readonly WriterId[]
  /** Reopened after being done, and not done again since. */
  readonly reopened: boolean
  /** Edited since it was reopened. */
  readonly changedSinceDone: boolean
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
 * `@pineta/schema` decides what each does to the document.
 */
export type StreamEvent =
  /** Text the model is writing, as a delta. */
  | { readonly kind: "text"; readonly lane: string; readonly delta: string }
  /** A message ended: its committed entry is the record from here on. */
  | { readonly kind: "messageEnd"; readonly lane: string }
  | {
      readonly kind: "toolStart"
      readonly lane: string
      readonly callId: string
      /** `toolLabel(name, args)`, so nothing downstream needs the arguments. */
      readonly label: string
    }
  /** The tool's output so far: a whole snapshot, not a delta. */
  | {
      readonly kind: "toolOutput"
      readonly lane: string
      readonly callId: string
      readonly text: string
    }
  | { readonly kind: "toolEnd"; readonly lane: string; readonly callId: string }

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
   * Candidates whose parent edge could not be satisfied from the already-
   * sequenced set or from this batch — a cycle, or an edge pointing outside
   * both. Returned rather than thrown so the caller can decide: the storage
   * adapter retries once with a full scan before giving up, because causal
   * delivery should make this impossible and a silent drop would be worse
   * than either.
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
 * `parentOf` returns `null`/`undefined` for a root, for an entry absent from
 * the document, or for a parent already sequenced — all of which make the
 * candidate immediately ready.
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

export * from "./edits.ts"
export * from "./presence.ts"
export * from "./roots.ts"
export * from "./tools.ts"
export * from "./tree.ts"
export * from "./work.ts"
