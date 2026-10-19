// ids — the branded ids every package names, and positions in the tree. A
// card's id, but a thread's and a canvas's, is `card-ids.ts`'.

// --- branded identifiers ----------------------------------------------------
//
// A brand turns a swapped argument into a compile error at the call site. It
// does nothing about serialization: a branded number drops into any `number`
// field, so no brand keeps a seq off the wire.

declare const writerIdBrand: unique symbol
/**
 * A person, as the transport identifies them, never as a message claims: the
 * principal their connection named, which is their email. Authorship is
 * recorded in each message by this id; people own no lanes.
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
 * A thread's id: `t-` and a uuidv7, minted by the column that opens the thread,
 * before anything is written. It also names the thread's lane, when it has one:
 * a lane has no id of its own, so no lane can be named by anything but a
 * thread. `newThreadId()` mints one (`@pinetrie/session`), `parseNewThread()`
 * checks one a client sends, and every reader of a stored one checks it with
 * `isThreadId()`, so no writer's id or `"main"` is one. `threadIdFor()` is for
 * fixtures and parsers alone: Biome refuses its import elsewhere.
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
 * undefined for anything else. Stricter than `isThreadId`: a lane's container
 * and volume are named after its thread's id.
 */
export const parseNewThread = (s: string): ThreadId | undefined =>
  NEW_THREAD.test(s) ? (s as ThreadId) : undefined

declare const canvasIdBrand: unique symbol
/**
 * A canvas's id: `k-` and a uuidv7, minted by the tab that opens the canvas, as it
 * mints a `RootId`. A canvas is a card on the board, and this is its card's id:
 * its place, its title, the sidebar and the layout are keyed by it. What it
 * holds is in the places document.
 */
export type CanvasId = string & { readonly [canvasIdBrand]: true }

const CANVAS_PREFIX = "k-"
const NEW_CANVAS =
  /^k-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A canvas's id from the text after its prefix: for fixtures and parsers. */
export const canvasIdFor = (id: string): CanvasId =>
  `${CANVAS_PREFIX}${id}` as CanvasId

/** The pattern a canvas's id matches (`isCanvasId`), for a stored schema. */
export const CANVAS_PATTERN = `^${CANVAS_PREFIX}[\\s\\S]`

/** Whether text names a canvas: the check wherever a canvas's id is read. */
export const isCanvasId = (s: string): s is CanvasId =>
  s.startsWith(CANVAS_PREFIX) && s.length > CANVAS_PREFIX.length

/** A new canvas's id as a client makes it, `k-` and a lowercase uuidv7; undefined for anything else. */
export const parseNewCanvas = (s: string): CanvasId | undefined =>
  NEW_CANVAS.test(s) ? (s as CanvasId) : undefined

declare const rootIdBrand: unique symbol
/**
 * A root's document's id: `r-` and a uuidv7, minted by the tab whose first
 * message starts the root, as a column mints its lane's id. Not the root
 * entry's id: a lane can exist in a root before pi writes its first entry. The
 * directory (`ROOT`) maps one to the other.
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
 * A workflow state's id: `w-` and an id the host mints as the state is added. A
 * state is named apart from its id, so a rename keeps every root's place.
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

/** The id of a root's document, which holds its pi storage. */
export const rootDocId = (root: RootId): string => `${ROOT_DOC_PREFIX}${root}`

/** A document id -> the root it is, or undefined for any other document. */
export function rootOfDocId(docId: string): RootId | undefined {
  if (!docId.startsWith(ROOT_DOC_PREFIX)) return undefined
  const root = docId.slice(ROOT_DOC_PREFIX.length)
  return isRootId(root) ? root : undefined
}

const SCRATCH_DOC_PREFIX = "scratch:"

/** The id of a root's scratch document, which holds pi's pending state while a run there needs it. */
export const scratchDocId = (root: RootId): string =>
  `${SCRATCH_DOC_PREFIX}${root}`

/** A document id -> the root whose scratch document it is, or undefined for any other document. */
export function rootOfScratchDocId(docId: string): RootId | undefined {
  if (!docId.startsWith(SCRATCH_DOC_PREFIX)) return undefined
  const root = docId.slice(SCRATCH_DOC_PREFIX.length)
  return isRootId(root) ? root : undefined
}

export const MOVES_DOC_PREFIX = "moves:"

/**
 * Which of a person's histories of moves a step is in: a canvas's, or theirs
 * outside any canvas (a trash from their inventory while on no canvas).
 */
export type MoveHistoryScope =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "person" }

export const PERSON_HISTORY: MoveHistoryScope = { kind: "person" }

/** The history of `canvas`, or the person's own for none. */
export const historyScope = (canvas: CanvasId | null): MoveHistoryScope =>
  canvas === null ? PERSON_HISTORY : { kind: "canvas", canvas }

/**
 * The host's undo stack of `writer`'s moves in `scope`: `moves:<writer>:<canvas>`
 * for a canvas's, `moves:<writer>` for theirs outside any canvas. Only the host
 * holds it.
 */
export const movesDocId = (
  writer: WriterId,
  scope: MoveHistoryScope,
): string =>
  scope.kind === "canvas"
    ? `${MOVES_DOC_PREFIX}${writer}:${scope.canvas}`
    : `${MOVES_DOC_PREFIX}${writer}`

/**
 * A document id -> the writer and scope whose moves' stack it is, or
 * undefined for any other document. A canvas's id holds no `:`, and an
 * email none (`normalizeEmail`), so a suffix after the last `:` that is a
 * canvas's id names a canvas's history, and none names the person's.
 */
export function movesOfDocId(
  docId: string,
): { readonly writer: WriterId; readonly scope: MoveHistoryScope } | undefined {
  if (!docId.startsWith(MOVES_DOC_PREFIX)) return undefined
  const rest = docId.slice(MOVES_DOC_PREFIX.length)
  const cut = rest.lastIndexOf(":")
  const canvas = cut <= 0 ? "" : rest.slice(cut + 1)
  if (isCanvasId(canvas))
    return {
      writer: rest.slice(0, cut) as WriterId,
      scope: { kind: "canvas", canvas },
    }
  return rest.startsWith("w-") && cut < 0
    ? { writer: rest as WriterId, scope: PERSON_HISTORY }
    : undefined
}

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Positions take an entry id; `activeRuns` holds run ids. Passing one
 * where the other belongs would otherwise compile, run, and fail silently. Mint
 * them only where they enter: the protocol codec, an address's parser
 * (`parseAddress`), the reads, the schema's readers, `@pinetrie/rules`'
 * decoders, the pi adapter, the client's stored forms, and the host's id
 * generator. `biome.json` refuses an `entryId` import in core, threads, the client
 * and the host, and a `runId` import in core, threads and the client.
 */
export type EntryId = string & { readonly [entryIdBrand]: true }
export type RunId = string & { readonly [runIdBrand]: true }
export const entryId = (id: string): EntryId => id as EntryId
export const runId = (id: string): RunId => id as RunId
declare const agentIdBrand: unique symbol
/**
 * The agent a message compels in its own thread: the host has one, `@agent`.
 * Other threads' agents are named by their threads (`Recipients.asks`).
 */
export type AgentId = string & { readonly [agentIdBrand]: true }
/** The host's agent, addressed as `@agent`. */
export const THE_AGENT = "agent" as AgentId

/**
 * `text` as a message that asks the agent, whatever else it mentions: a
 * mention of a person alone would address the message to them instead.
 */
export const agentAsk = (text: string): string => `@${THE_AGENT} ${text}`

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
 * A position in a given root: what a command or a card's place carries where it
 * points into the tree, so the host knows the document without looking the
 * entry up.
 */
export interface Spot {
  readonly root: RootId
  readonly at: Position
}
