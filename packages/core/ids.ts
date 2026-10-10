// ids — every branded id, and positions in the tree (ADR-0063, ADR-0117,
// ADR-0126). Re-exported from `index.ts`. A card's id's prefix is its kind's
// (`KINDS`): this module reads `KINDS`' value, and `kinds.ts` imports only
// types from here, so the two never load in a cycle.

import { KINDS } from "./kinds.ts"
import type { IdOf } from "./places.ts"

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

/** A card's id with its kind (`kindOfCard`), so a switch on one narrows the other. */
export type KindedId = {
  [K in CardKind]: { readonly kind: K; readonly id: IdOf<K> }
}[CardKind]

/** `id` with its kind, read from its prefix (`KINDS`). */
export const kindedId = (id: CardId): KindedId =>
  ({ kind: kindOfCard(id), id }) as KindedId

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
