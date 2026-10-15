// reads — what the session's documents say, read once, for the host and the
// client alike, so a promise the page makes is decided from the facts the
// host decides from.
//
// Reads of a document handle: no subscription and no pi. The only caches
// are keyed by objects Kyneta keeps while their content is unchanged, so a hit
// returns what reading again would.

import {
  type AcceptedRecord,
  type AccessRecord,
  type AgentMessageLike,
  type AgentRun,
  type ArchivedTask,
  agentActivity,
  ancestry,
  type BannerRecord,
  type BaseRecord,
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type CommandSummary,
  type ContextInView,
  type DigestRecord,
  type EntryId,
  type EntryLike,
  entryId,
  firstLineOf,
  type IconsRecord,
  indexTree,
  isRootId,
  isTaskId,
  isThreadId,
  type LaneRecord,
  type LaneView,
  type MarkRecord,
  messageImages,
  messageText,
  type NoteColumnId,
  type NoteColumnRecord,
  type OfferRecord,
  type PlanMode,
  type ProjectRecord,
  parseCardId,
  parseMentions,
  promptOf,
  type QueueHold,
  type RevisionRecord,
  type RootId,
  type RootRecord,
  type SeatRecord,
  type SetupRecord,
  type Sha256,
  type SharedLineage,
  type SnapshotId,
  summarizeRoots,
  type TaskId,
  type ThreadId,
  type ThreadLane,
  type ThreadName,
  type ThreadRecord,
  type TraceRecord,
  type TreeIndex,
  type VerdictRecord,
  type Workflow,
  type WriterId,
  writersOf,
} from "@pinetrie/core"
import {
  ACCEPTED,
  ACCEPTED_KEY,
  ACCESS,
  archivedOf,
  BANNER,
  BASE,
  BUDGET,
  type BudgetRecord,
  boardTasks,
  CARD_HISTORY,
  COMMANDS,
  COMMANDS_KEY,
  contextOf,
  DIGEST,
  decodeCard,
  decodeChat,
  FILES_LOST,
  type FilesLostRecord,
  type Home,
  ICONS,
  ICONS_KEY,
  LANE,
  MARK,
  NAME,
  NOTE_COLUMN,
  OFFER,
  PARTICIPANT,
  PICTURE,
  PROJECT,
  PROJECT_KEY,
  participants,
  pastedImages,
  promptAuthor,
  QUEUE_HOLD,
  queuedOn,
  REVISION,
  type RecordSpec,
  ROOT,
  recordsIn,
  renderableMessage,
  SEAT,
  SETUP,
  SETUP_KEY,
  SHARED_LINEAGE,
  THREAD,
  TRACE,
  threadNameOf,
  VERDICT,
  WORKFLOW,
  WORKFLOW_KEY,
} from "@pinetrie/rules"
import {
  type LiveDocHandle,
  type PlacesDocHandle,
  type PresenceDocHandle,
  type RootDocHandle,
  readActiveRun,
  readEntries,
  readEntryMessage,
  readLaneNames,
  readLaneTip,
  readNamespace,
  rowMessage,
  rowRetainedTail,
  type SessionDocHandle,
  type StoredEntryRow,
  writerOfKey,
} from "@pinetrie/schema"

/**
 * Each stored row's entry, decoded once. Kyneta returns the same frozen row
 * object for as long as the entry is unchanged, so a row is its own
 * cache key and a hit is always current.
 */
const entryOfRow = new WeakMap<StoredEntryRow, EntryLike>()

/** The tree index of each `entries` record, which Kyneta keeps while no entry changes. */
const indexOfEntries = new WeakMap<
  Readonly<Record<string, StoredEntryRow>>,
  TreeIndex
>()

/**
 * The context entries a compaction's retained tail carries: the newest of
 * each kind, which pi's compaction hook puts there; undefined for none.
 */
function carriedBy(row: StoredEntryRow): ContextInView | undefined {
  const carried = contextOf(rowRetainedTail(row))
  return Object.keys(carried).length === 0 ? undefined : carried
}

/**
 * A row's entry, or null for one whose thread is no thread's id. None is:
 * every commit names its thread, and a store from before the column is
 * refused at startup. Left out, as a malformed lane
 * name is (`readStoredLanes`), rather than read into some thread.
 */
function renderableEntry(row: StoredEntryRow): EntryLike | null {
  const known = entryOfRow.get(row)
  if (known !== undefined) return known
  const { thread } = row
  if (!isThreadId(thread)) return null
  const carried = carriedBy(row)
  const entry: EntryLike = Object.freeze({
    id: entryId(row.id),
    parentId: row.parentId === null ? null : entryId(row.parentId),
    type: row.type,
    thread,
    message: renderableMessage(rowMessage(row)),
    ...(carried === undefined ? {} : { carried }),
  })
  entryOfRow.set(row, entry)
  return entry
}

/** Keyed by each entry's own id: `Object.entries` would give plain strings. */
function renderableEntries(
  rows: Readonly<Record<string, StoredEntryRow>>,
): Record<EntryId, EntryLike> {
  const out: Record<EntryId, EntryLike> = {}
  for (const row of Object.values(rows)) {
    const entry = renderableEntry(row)
    if (entry !== null) out[entry.id] = entry
  }
  return out
}

/**
 * Stored rows -> the shape the projections read. `message` is pi's
 * variant data, lifted by `rowMessage`; a human's chat is decoded here, by
 * `renderableMessage`, into role `chat` with its author and writer. An
 * unchanged row gives the same entry, frozen.
 */
export const readRenderableEntries = (
  doc: RootDocHandle,
): Record<EntryId, EntryLike> => renderableEntries(readEntries(doc))

/**
 * The tree, indexed once per change of its entries (`indexTree`): a document
 * change that touches no entry returns the same index. Every caller shares it,
 * so none may sort or change its lists in place.
 */
export function readTreeIndex(doc: RootDocHandle): TreeIndex {
  const rows = readEntries(doc)
  const known = indexOfEntries.get(rows)
  if (known !== undefined) return known
  const index = indexTree(renderableEntries(rows))
  indexOfEntries.set(rows, index)
  return index
}

/** The index of several roots' entries at once, as the last call built it. */
let heldIndex: {
  readonly rows: readonly Readonly<Record<string, StoredEntryRow>>[]
  readonly index: TreeIndex
} | null = null

/**
 * The tree of every root in `docs`, one index over all their entries: what a
 * page reads of the roots its tabs hold. The same index while no
 * root's entries change, as `readTreeIndex` gives one root's.
 */
export function readHeldIndex(docs: readonly RootDocHandle[]): TreeIndex {
  if (docs.length === 1 && docs[0] !== undefined) return readTreeIndex(docs[0])
  const rows = docs.map(readEntries)
  if (
    heldIndex !== null &&
    heldIndex.rows.length === rows.length &&
    heldIndex.rows.every((r, i) => r === rows[i])
  )
    return heldIndex.index
  const entries: Record<EntryId, EntryLike> = {}
  for (const r of rows) Object.assign(entries, renderableEntries(r))
  const index = indexTree(entries)
  heldIndex = { rows, index }
  return index
}

/** Each root's records `read` gives, as one map: roots never share a key. */
export function readHeld<K, V>(
  docs: readonly RootDocHandle[],
  read: (doc: RootDocHandle) => ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
  if (docs.length === 1 && docs[0] !== undefined) return read(docs[0])
  return new Map(docs.flatMap(doc => [...read(doc)]))
}

/** Whether a lane is running now: `pinetrie:live` records its active run. */
export const readRunning = (live: LiveDocHandle, lane: ThreadId): boolean =>
  readActiveRun(live, lane) !== undefined

/**
 * A root's documents, for a read of several: the root's own, for
 * its lanes and their tips; the session's, for the lanes' records; and
 * `pinetrie:live`, for which of them run.
 */
export interface RootView {
  readonly root: RootId
  readonly doc: RootDocHandle
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
}

/**
 * The prompt of the lane's latest run, and its role (`chat`, `land`,
 * `stack`…): what the run is. Null for a lane with no run on its tip's path.
 */
export function readLatestPrompt(
  doc: RootDocHandle,
  lane: ThreadId,
): { readonly id: EntryId; readonly role: string | undefined } | null {
  const index = readTreeIndex(doc)
  const id = promptOf(index, readLaneTip(doc, lane))
  return id === null ? null : { id, role: index.entries[id]?.message?.role }
}

/**
 * A lane's latest run's prompt, as stored: its id and its message, for a
 * decoder of its own (`promptAuthor`, `decodeRelay`). Null for a lane with no
 * prompt, or one whose message is not stored.
 */
export function readPromptMessage(
  doc: RootDocHandle,
  lane: ThreadId,
): { readonly id: EntryId; readonly message: unknown } | null {
  const latest = readLatestPrompt(doc, lane)
  if (latest === null) return null
  const stored = readEntryMessage(doc, latest.id)
  return stored.present ? { id: latest.id, message: stored.message } : null
}

/**
 * The person behind a lane's latest run: its prompt's author, a
 * chat's or a land or stack message's `by` (`promptAuthor`); else whoever
 * started the lane. Null for a lane with neither.
 */
export function readRunAuthor(
  doc: RootDocHandle,
  session: SessionDocHandle,
  lane: ThreadId,
): WriterId | null {
  const prompt = readPromptMessage(doc, lane)
  return (
    (prompt === null ? null : promptAuthor(prompt.message)) ??
    readLaneRecords(session).get(lane)?.by ??
    null
  )
}

/**
 * Who asked the run that wrote `tip`: the writer of its prompt
 * (`promptOf`), when a person's message started it.
 */
function askerOf(index: TreeIndex, tip: EntryId | null): WriterId | undefined {
  const prompt = promptOf(index, tip)
  const message = prompt === null ? undefined : index.entries[prompt]?.message
  return message?.role === "chat" ? message.writer : undefined
}

/**
 * Every thread lane: its tip, whether it runs, how many cards wait for it,
 * who holds it (for a conflict's "by"): the writer of the ask
 * it is answering (`askerOf`), or who queued its first card; who queued
 * its last card, whom a card queued now follows; and who holds its queue.
 * `cards` is every card's record (`readPlaces`), `holds`
 * the session's held queues (`readQueueHolds`). A blank queued message
 * (`blank`, `blankQueued`) does not wait: the drain passes over it, so a
 * queue of blank cards alone leaves its lane idle.
 */
export function readLanes(
  view: Pick<RootView, "doc" | "live">,
  index: TreeIndex,
  cards: readonly CardRecord[],
  holds: ReadonlyMap<ThreadId, QueueHold>,
  blank: ReadonlySet<CardId>,
): readonly LaneView[] {
  const { doc, live } = view
  return readLaneNames(doc).map(name => {
    const tip = readLaneTip(doc, name)
    const running = readRunning(live, name)
    const queue = queuedOn(cards, name).filter(c => !blank.has(c.id))
    const asking = running ? askerOf(index, tip) : queue[0]?.place.by
    return {
      name,
      tip,
      running,
      waiting: queue.length,
      askedBy: asking ?? null,
      lastWaiting: queue.at(-1)?.place.by ?? null,
      heldBy: holds.get(name)?.by ?? null,
    }
  })
}

/** Every lane the agent is replying on, in this root. */
export function readAgentActivity(
  view: Pick<RootView, "doc" | "live">,
): readonly AgentRun[] {
  const { doc, live } = view
  return agentActivity(
    readLaneNames(doc)
      .filter(lane => readRunning(live, lane))
      .map(lane => ({ lane, tip: readLaneTip(doc, lane) })),
  )
}

/** The document a record's home names. */
export type HomeDoc<H extends Home> = H extends "root"
  ? RootDocHandle
  : SessionDocHandle

/** Each spec's records, by the stored namespace they were decoded from. */
const decoded = new WeakMap<
  object,
  WeakMap<object, ReadonlyMap<string, unknown>>
>()

/**
 * Every record `spec` describes, by its address, from the
 * document its home names. Each named reader below is this, for one record.
 * The same map while its namespace is unchanged: the stored namespace keeps
 * its identity across writes to others, so a write decodes only its
 * own namespace's records again.
 */
export function readRecords<R, K extends string, H extends Home>(
  doc: HomeDoc<H>,
  spec: RecordSpec<R, K, H>,
): ReadonlyMap<K, R> {
  const namespace = readNamespace(doc, spec.namespace)
  const bySpec = decoded.get(spec) ?? new WeakMap()
  decoded.set(spec, bySpec)
  const known = bySpec.get(namespace)
  // Cached by this spec alone, so the map holds its own records.
  if (known !== undefined) return known as ReadonlyMap<K, R>
  const records = recordsIn(spec, namespace)
  bySpec.set(namespace, records)
  return records
}

/** Every root's directory record (`pinetrie.root`), by its id. */
export const readRoots = (
  doc: SessionDocHandle,
): ReadonlyMap<RootId, RootRecord> => readRecords(doc, ROOT)

/**
 * The roots the directory names, with a record that decodes or not: a root
 * whose record is in an older shape is started all the same, and a reader
 * that took `readRoots`' keys would leave it out until the directory
 * rewrote it.
 */
export const readStartedRoots = (doc: SessionDocHandle): ReadonlySet<RootId> =>
  new Set(Object.keys(readNamespace(doc, ROOT.namespace)).filter(isRootId))

/** Every lane the agent is replying on, in any root, and the root it is in. */
export function readRunningLanes(
  session: SessionDocHandle,
  live: LiveDocHandle,
): readonly { readonly lane: ThreadId; readonly root: RootId }[] {
  return [...readLaneRecords(session).values()]
    .filter(r => readRunning(live, r.lane))
    .map(r => ({ lane: r.lane, root: r.root }))
}

/**
 * `read`, returning its last result for a document (its first argument)
 * while a new one is `same`. Kyneta gives a record a new identity on every write, the same
 * value written again included, and a memo or `React.memo` keyed on a read
 * skips only while the read keeps its identity.
 */
function keptWhileSame<D extends object, T, R extends readonly unknown[] = []>(
  read: (doc: D, ...rest: R) => T,
  same: (a: T, b: T) => boolean,
): (doc: D, ...rest: R) => T {
  const last = new WeakMap<D, T>()
  return (doc, ...rest) => {
    const now = read(doc, ...rest)
    const before = last.get(doc)
    if (before !== undefined && same(before, now)) return before
    last.set(doc, now)
    return now
  }
}

/** Whether two maps hold the same keys, each with the same value. */
const sameMap = <K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean =>
  a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k) === v)

/**
 * Each writer's display name (`pinetrie.participant`). The same map while the
 * names are the same: every message compares it by identity, and the
 * session's other records, the directory's among them, change far more often.
 */
export const readParticipantNames = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<WriterId, string> =>
    new Map(
      [...readRecords(doc, PARTICIPANT).values()].map(r => [r.writer, r.name]),
    ),
  sameMap,
)

/**
 * Each writer's picture (`pinetrie.picture`). The same map while
 * the pictures are the same, as `readParticipantNames`: every circle on the
 * page reads it.
 */
export const readParticipantPictures = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<WriterId, Sha256> =>
    new Map(
      [...readRecords(doc, PICTURE).values()].map(r => [r.writer, r.sha256]),
    ),
  sameMap,
)

/**
 * Every participant's display name, guests included: the list a mention
 * resolves against (`address`), and the names the screen shows. A writer is
 * found in `index`, else in any root's directory record, so one who wrote
 * only in a root not loaded still counts.
 */
export const readParticipants = (
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly string[] =>
  participantsIn(readParticipantNames(doc), index, readRoots(doc))

/** `readParticipants` over what a reader already holds. */
export function participantsIn(
  names: ReadonlyMap<WriterId, string>,
  index: TreeIndex,
  directory: ReadonlyMap<RootId, RootRecord>,
): readonly string[] {
  const writers = Object.values(index.entries).flatMap(e =>
    e.message?.writer === undefined ? [] : [e.message.writer],
  )
  for (const root of directory.values()) writers.push(...root.writers)
  return participants(names, writers)
}

/**
 * One field of the presence document: an entry per key, as its writer and
 * value. A person here from two seats appears twice.
 */
export type PresenceEntries = readonly (readonly [WriterId, EntryId])[]

const samePairs = (a: PresenceEntries, b: PresenceEntries): boolean =>
  a.length === b.length &&
  a.every((pair, i) => pair[0] === b[i]?.[0] && pair[1] === b[i]?.[1])

/**
 * A read of one presence field's live entries. A decayed value is `null` and
 * its key stays, so nulls are skipped here, once. Every key starts with its
 * seat's `seatKey`, and the writer is what comes before the first colon
 * (`writerOfKey`).
 *
 * The page's refresh writes the same values again, so the result is kept
 * while its entries are the same (`keptWhileSame`).
 */
const presenceField = (
  field: (doc: PresenceDocHandle) => Record<string, string | null>,
): ((doc: PresenceDocHandle) => PresenceEntries) =>
  keptWhileSame(
    doc =>
      Object.entries(field(doc)).flatMap(([key, value]) => {
        const writer = writerOfKey(key)
        return value === null || writer === undefined
          ? []
          : [[writer as WriterId, entryId(value)] as const]
      }),
    samePairs,
  )

/** One entry per open column: its writer, and the thread end it follows. */
export const readReading = presenceField(doc => doc.reading())
/**
 * Each followed thread end's task, from the column that reports it: what a
 * window that does not hold the thread's root names it by. Kept while unchanged, as `presenceField`'s reads are.
 */
export const readReadingTasks = keptWhileSame(
  (doc: PresenceDocHandle): ReadonlyMap<EntryId, TaskId> => {
    const tasks = doc.readingTask()
    const now = new Map<EntryId, TaskId>()
    for (const [key, end] of Object.entries(doc.reading())) {
      const task = tasks[key]
      if (end !== null && typeof task === "string" && isTaskId(task))
        now.set(entryId(end), task)
    }
    return now
  },
  sameMap,
)

/** One entry per seat typing: its writer, and the thread end. */
export const readTyping = presenceField(doc => doc.typing())

/**
 * The cards someone is typing in now (`typingIn`), from any seat: the host
 * pops none of them. Kept while the same cards.
 */
export const readTypingIn = keptWhileSame(
  (doc: PresenceDocHandle): ReadonlySet<CardId> =>
    new Set(
      Object.values(doc.typingIn()).flatMap(text => {
        const card = text === null ? undefined : parseCardId(text)
        return card === undefined ? [] : [card]
      }),
    ),
  (a, b) => a.size === b.size && [...a].every(c => b.has(c)),
)

/** Whether two holds say the same: who, and since when. */
const sameHolds = (
  a: ReadonlyMap<ThreadId, QueueHold>,
  b: ReadonlyMap<ThreadId, QueueHold>,
): boolean =>
  a.size === b.size &&
  [...a].every(([lane, h]) => {
    const o = b.get(lane)
    return o !== undefined && o.by === h.by && o.at === h.at
  })

/** Every thread's record, by its id. */
export const readThreads = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, ThreadRecord> => readRecords(doc, THREAD)

/** Each shared file's lineage (`pinetrie.shared`), by its path. */
export const readSharedLineages = (
  doc: SessionDocHandle,
): ReadonlyMap<string, SharedLineage> => readRecords(doc, SHARED_LINEAGE)

/** Each lane whose fork's files were not kept (`pinetrie.files-lost`). */
export const readFilesLost = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, FilesLostRecord> => readRecords(doc, FILES_LOST)

/**
 * Each held queue (`pinetrie.queue-hold`), by lane. The same map while the
 * holds are, since every session write wakes it.
 */
export const readQueueHolds = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<ThreadId, QueueHold> =>
    readRecords(doc, QUEUE_HOLD),
  sameHolds,
)

/** Every seat the host has seen (`pinetrie.seat`), first seen first. */
export const readSeats = (doc: SessionDocHandle): readonly SeatRecord[] =>
  [...readRecords(doc, SEAT).values()].sort((a, b) => a.at - b.at)

// Each stored card row as last decoded. Kyneta gives an unchanged `json`
// row the same object across writes, so an unchanged card keeps its record
// object, and a change to one card redraws only what shows it.
const decodedRows = new WeakMap<object, CardRecord | null>()

const decodeRow = (id: string, row: object): CardRecord | null => {
  const was = decodedRows.get(row)
  if (was !== undefined && (was === null || was.id === id)) return was
  const card = decodeCard(id, row) ?? null
  decodedRows.set(row, card)
  return card
}

/**
 * Every card's record, oldest first (ids are uuidv7), from the
 * places document. A card that does not decode is left out.
 */
export function readPlaces(places: PlacesDocHandle): readonly CardRecord[] {
  return Object.entries(places.cards() as Record<string, object>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([id, row]) => {
      const card = decodeRow(id, row)
      return card === null ? [] : [card]
    })
}

/** The places document's `rev`: raised with every write. */
export const readPlacesRev = (places: PlacesDocHandle): number => places.rev()

/** The session's workflow (`pinetrie.workflow`), or null before a host wrote it. */
export const readWorkflow = (doc: SessionDocHandle): Workflow | null =>
  readRecords(doc, WORKFLOW).get(WORKFLOW_KEY) ?? null

/** Every task the session holds: each one whose card is on the board. */
export const readTasks = (places: PlacesDocHandle): ReadonlySet<TaskId> =>
  boardTasks(readPlaces(places))

/**
 * The tasks in the archive, archived, by id, from the
 * board's cards and their histories (`archivedOf`); none before a host
 * wrote the workflow. The same map while the same tasks are archived by the
 * same writers at the same times: every write to the session's values
 * wakes it, the directory's included.
 */
export const readArchived = keptWhileSame(
  (
    doc: SessionDocHandle,
    places: PlacesDocHandle,
  ): ReadonlyMap<TaskId, ArchivedTask> => {
    const workflow = readWorkflow(doc)
    return workflow === null
      ? new Map()
      : archivedOf(workflow, readPlaces(places), readCardHistories(doc))
  },
  (a, b) =>
    a.size === b.size &&
    [...a].every(([k, v]) => {
      const w = b.get(k)
      return w !== undefined && w.by === v.by && w.at === v.at
    }),
)

/** Every task's title (`pinetrie.mark`), by task. */
export const readMarks = (
  doc: SessionDocHandle,
): ReadonlyMap<TaskId, MarkRecord> => readRecords(doc, MARK)

/** Each titled note column's title (`pinetrie.note-column`), by id. */
export const readNoteColumns = (
  doc: SessionDocHandle,
): ReadonlyMap<NoteColumnId, NoteColumnRecord> => readRecords(doc, NOTE_COLUMN)

/** Each ask's digest (`pinetrie.digest`), by its prompt. */
export const readDigests = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, DigestRecord> => readRecords(doc, DIGEST)

/** Every card's history (`pinetrie.card-history`), by card. */
export const readCardHistories = (
  doc: SessionDocHandle,
): ReadonlyMap<CardId, CardHistoryRecord> => readRecords(doc, CARD_HISTORY)

/** Every trace (`pinetrie.trace`), by id. */
export const readTraces = (
  doc: SessionDocHandle,
): ReadonlyMap<string, TraceRecord> => readRecords(doc, TRACE)

/** Each thread's last run's verdict (`pinetrie.verdict`), by lane. */
export const readVerdicts = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, VerdictRecord> => readRecords(doc, VERDICT)

// ── where lanes work ──────────────────────────────────────────────────────

/** Every lane's record (`pinetrie.lane`): where it works, by lane. */
export const readLaneRecords = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, LaneRecord> => readRecords(doc, LANE)

/** Every revision record (`pinetrie.revision`), by the entry it is at. */
export const readRevisions = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, RevisionRecord> => readRecords(doc, REVISION)

/** The snapshots of `lane`'s own revision records in `doc`, newest first. */
export const readLaneSnapshots = (
  doc: RootDocHandle,
  lane: ThreadId,
): SnapshotId[] =>
  [...readRevisions(doc).values()]
    .filter(r => r.lane === lane)
    .sort((a, b) => (a.entry < b.entry ? 1 : -1))
    .flatMap(r => (r.snapshot === null ? [] : [r.snapshot]))

/** Each lane's offer in your repo, by lane. */
export const readOffers = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, OfferRecord> => readRecords(doc, OFFER)

/** Accepted work as the host last read it; null before it wrote one. */
export const readAccepted = (doc: SessionDocHandle): AcceptedRecord | null =>
  readRecords(doc, ACCEPTED).get(ACCEPTED_KEY) ?? null

/** Each lane's base as its history says it, by lane. */
export const readBases = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, BaseRecord> => readRecords(doc, BASE)

/** Each budget for agents talking, by the message that set it. */
export const readBudgets = (
  doc: SessionDocHandle,
): ReadonlyMap<EntryId, BudgetRecord> => readRecords(doc, BUDGET)

/** Each lane's name (`pinetrie.name`), by lane. */
export const readNames = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, ThreadName> =>
  new Map([...readRecords(doc, NAME).values()].map(r => [r.lane, r.name]))

/** Each lane's ssh identities and its owner's answers (`pinetrie.access`), by lane. */
export const readAccess = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, AccessRecord> => readRecords(doc, ACCESS)

/** Each thread's banner (`pinetrie.banner`), by lane. */
export const readBanners = (
  doc: SessionDocHandle,
): ReadonlyMap<ThreadId, BannerRecord> => readRecords(doc, BANNER)

/** A lane as people read it (`threadNameOf`). */
export const readThreadName = (doc: SessionDocHandle, lane: ThreadId): string =>
  threadNameOf(readNames(doc), lane)

/** What the host found where it runs (`pinetrie.project`); null with no tools. */
export const readProject = (doc: SessionDocHandle): ProjectRecord | null =>
  readRecords(doc, PROJECT).get(PROJECT_KEY) ?? null

/** What the host read of its config (`pinetrie.setup`); null before a host wrote it. */
export const readSetup = (doc: SessionDocHandle): SetupRecord | null =>
  readRecords(doc, SETUP).get(SETUP_KEY) ?? null

/** The host's icon source (`pinetrie.icons`); null before a host wrote it. */
export const readIcons = (doc: SessionDocHandle): IconsRecord | null =>
  readRecords(doc, ICONS).get(ICONS_KEY) ?? null

/** The commands the host's pi loaded; none before a host wrote them. */
export const readCommands = (
  doc: SessionDocHandle,
): readonly CommandSummary[] =>
  readRecords(doc, COMMANDS).get(COMMANDS_KEY)?.commands ?? []

/**
 * Whether a send's thread works, or will work, in its own copy: its lane is
 * one of its own, or the send would create a lane on a host with tools,
 * whose new lanes all have their own. Paths to your working copy, and to
 * granted host paths, are then written as the lane sees them.
 */
export function worksOwn(
  session: SessionDocHandle,
  send: {
    readonly lane: ThreadLane
    readonly mode: PlanMode
  },
): boolean {
  if (send.lane.kind === "lane" && send.mode !== "branch")
    return (
      (readLaneRecords(session).get(send.lane.name)?.history ?? null) !== null
    )
  return readProject(session) !== null
}

// --- blobs --------------------------------------------------------------------

/**
 * Every blob something still shows: each chat's images, each tool result's,
 * each `/blob/` image in the texts people type, every card's, queued ones
 * among them, and each thread's banner. A card holds what a composer has
 * typed, pasted images included, so the caller passes every text, not only
 * those it has loaded.
 */
export function referencedBlobs(facts: {
  readonly messages: Iterable<unknown>
  readonly texts: Iterable<string>
  readonly banners: Iterable<BannerRecord>
}): ReadonlySet<Sha256> {
  const shas = new Set<Sha256>()
  for (const banner of facts.banners) shas.add(banner.sha)
  for (const message of facts.messages) {
    for (const image of decodeChat(message)?.images ?? [])
      shas.add(image.sha256)
    for (const image of messageImages(message as AgentMessageLike))
      shas.add(image.sha256)
  }
  for (const text of facts.texts)
    for (const sha of pastedImages(text)) shas.add(sha)
  return shas
}

/**
 * Every image something still shows (`referencedBlobs`): each root's, from
 * its directory record, so no root is opened to sweep; every card's text;
 * every banner; and every person's picture.
 */
export const readReferencedBlobs = (
  session: SessionDocHandle,
  texts: Iterable<string>,
): ReadonlySet<Sha256> => {
  const shas = new Set(
    referencedBlobs({
      messages: [],
      texts,
      banners: readBanners(session).values(),
    }),
  )
  for (const root of readRoots(session).values())
    for (const sha of root.images) shas.add(sha)
  for (const picture of readRecords(session, PICTURE).values())
    shas.add(picture.sha256)
  return shas
}

/**
 * A root's directory record, read from its document: its first
 * message and that message's first line, its messages, newest
 * entry and writers (`summarizeRoots`), each thread's writers on its path,
 * its chats that name someone, and every image it shows. What
 * the host writes as `pinetrie.root`.
 */
export function readRootRecord(root: RootId, doc: RootDocHandle): RootRecord {
  const index = readTreeIndex(doc)
  const summary = summarizeRoots(index)[0]
  const entry = summary?.root ?? null
  const first = summary?.first ?? null
  const mentions = Object.values(index.entries).flatMap(e => {
    const m = e.message
    if (m?.role !== "chat" || m.writer === undefined) return []
    const text = messageText(m)
    return parseMentions(text).length === 0
      ? []
      : [{ id: e.id, by: m.writer, text, thread: e.thread }]
  })
  return {
    root,
    entry,
    first,
    firstLine: firstLineOf(index, first),
    messages: summary?.messages ?? 0,
    newest: summary?.newest ?? null,
    writers: summary?.writers ?? [],
    threads: Object.fromEntries(
      readLaneNames(doc).map(lane => [
        lane,
        writersOf(index, ancestry(index, readLaneTip(doc, lane)).path),
      ]),
    ),
    mentions: mentions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    images: [
      ...referencedBlobs({
        messages: Object.values(readEntries(doc)).map(rowMessage),
        texts: [],
        banners: [],
      }),
    ].sort(),
  }
}

/**
 * The blobs to delete: those nothing shows and nobody has stored or touched
 * within `grace`. The grace covers an image pasted and not yet sent, which
 * only a composer holds.
 */
export function planSweep(input: {
  readonly stored: readonly {
    readonly sha256: Sha256
    readonly touched: number
  }[]
  readonly referenced: ReadonlySet<Sha256>
  readonly now: number
  readonly grace: number
}): Sha256[] {
  return input.stored
    .filter(
      b =>
        !input.referenced.has(b.sha256) && input.now - b.touched > input.grace,
    )
    .map(b => b.sha256)
}
