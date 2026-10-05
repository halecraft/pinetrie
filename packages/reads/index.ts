// reads — what the session's documents say, read once, for the host and the
// client alike.
//
// Each read takes the documents it reads (ADR-0063): a root's (`RootDocHandle`:
// its entries, pi's values for its lanes, the records keyed by its entries),
// the session's (`SessionDocHandle`: the records read across roots), or
// `pinetrie:live`. A read of several takes a `RootView`.
//
// The composer promises "send" or "queue" from the same facts the host then
// decides from. If the two read those facts separately, the promise holds only
// while two copies stay in step, which is the drift this project keeps
// meeting. So both read here. `packages/client/projection.ts` gathers these
// for the page; a stream's text is `readStreams`, in `@pinetrie/schema`.
//
// Pure reads of a document handle: no subscription and no pi. The only caches
// are keyed by objects Kyneta keeps while their content is unchanged, so a hit
// returns what reading again would.

import {
  type Above,
  type AgentMessageLike,
  type AgentRun,
  type ArchivedRoot,
  agentActivity,
  ancestry,
  type BannerRecord,
  type BaseRecord,
  type BoardPlace,
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type CommandSummary,
  cardId,
  type DigestRecord,
  type EntryId,
  type EntryLike,
  entryId,
  firstLineOf,
  indexTree,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type LineRecord,
  type MarkRecord,
  messageImages,
  messageText,
  nearestRevision,
  type OfferRecord,
  type PinnedView,
  type PlanMode,
  type Position,
  type ProjectRecord,
  parseMentions,
  promptOf,
  type QueueHold,
  type RevisionRecord,
  type RootId,
  type RootRecord,
  type SeatRecord,
  type Sha256,
  type StopRecord,
  summarizeRoots,
  type ThreadLane,
  type ThreadName,
  type TraceRecord,
  type TreeIndex,
  type VerdictRecord,
  type Workflow,
  type WorkSetting,
  type WriterId,
  workFor,
  writersOf,
} from "@pinetrie/core"
import {
  archivedOf,
  BANNER,
  BASE,
  BOARD,
  CARD_HISTORY,
  COMMANDS,
  COMMANDS_KEY,
  DIGEST,
  decodeCard,
  decodeChat,
  decodePinned,
  type Home,
  LANE,
  LINE,
  LINE_KEY,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
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
  recordsOf,
  renderableMessage,
  SEAT,
  STOP,
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
  readValues,
  rowMessage,
  rowRetainedTail,
  type SessionDocHandle,
  type StoredEntryRow,
  writerOfKey,
} from "@pinetrie/schema"

/**
 * Each stored row's entry, decoded once. Kyneta returns the same frozen row
 * object for as long as the entry is unchanged (S54), so a row is its own
 * cache key and a hit is always current.
 */
const entryOfRow = new WeakMap<StoredEntryRow, EntryLike>()

/** The tree index of each `entries` record, which Kyneta keeps while no entry changes (S54). */
const indexOfEntries = new WeakMap<
  Readonly<Record<string, StoredEntryRow>>,
  TreeIndex
>()

/**
 * The pinned cards a compaction's retained tail carries: its newest cards
 * entry, which pi's compaction hook puts there (ADR-0048, S92); absent for
 * none.
 */
function carriedBy(row: StoredEntryRow): PinnedView | undefined {
  const tail = rowRetainedTail(row)
  for (let i = tail.length - 1; i >= 0; i--) {
    const view = decodePinned(tail[i])
    if (view !== undefined) return view
  }
  return undefined
}

function renderableEntry(row: StoredEntryRow): EntryLike {
  const known = entryOfRow.get(row)
  if (known !== undefined) return known
  const carried = carriedBy(row)
  const entry: EntryLike = Object.freeze({
    id: entryId(row.id),
    parentId: row.parentId === null ? null : entryId(row.parentId),
    type: row.type,
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
    out[entry.id] = entry
  }
  return out
}

/**
 * Stored rows -> the shape the projections read (ADR-0015). `message` is pi's
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
 * page reads of the roots its tabs hold (ADR-0063). The same index while no
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
export const readRunning = (live: LiveDocHandle, lane: LaneName): boolean =>
  readActiveRun(live, lane) !== undefined

/**
 * A root's documents, for a read of several (ADR-0063): the root's own, for
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
  lane: LaneName,
): { readonly id: EntryId; readonly role: string | undefined } | null {
  const index = readTreeIndex(doc)
  const id = promptOf(index, readLaneTip(doc, lane))
  return id === null ? null : { id, role: index.entries[id]?.message?.role }
}

/**
 * The person behind a lane's latest run (ADR-0080): its prompt's author, a
 * chat's or a land or stack message's `by` (`promptAuthor`); else whoever
 * started the lane. Null for a lane with neither.
 */
export function readRunAuthor(
  doc: RootDocHandle,
  session: SessionDocHandle,
  lane: LaneName,
): WriterId | null {
  const latest = readLatestPrompt(doc, lane)
  const stored =
    latest === null
      ? { present: false as const }
      : readEntryMessage(doc, latest.id)
  return (
    (stored.present ? promptAuthor(stored.message) : null) ??
    readLaneRecords(session).get(lane)?.by ??
    null
  )
}

/**
 * Who asked the run that wrote `tip`: the writer of its prompt
 * (`promptOf`, ADR-0056), when a person's message started it.
 */
function askerOf(index: TreeIndex, tip: EntryId | null): WriterId | undefined {
  const prompt = promptOf(index, tip)
  const message = prompt === null ? undefined : index.entries[prompt]?.message
  return message?.role === "chat" ? message.writer : undefined
}

/**
 * Every thread lane: its tip, whether it runs, how many cards are queued for
 * it (ADR-0048), who holds it (for a conflict's "by"): the writer of the ask
 * it is answering (`askerOf`), or who queued its first card; who queued
 * its last card, whom a card queued now follows; and who holds its queue
 * (ADR-0048 step 7). `cards` is every card's record (`readPlaces`), `holds`
 * the session's held queues (`readQueueHolds`).
 */
export function readLanes(
  view: Pick<RootView, "doc" | "live">,
  index: TreeIndex,
  cards: readonly CardRecord[],
  holds: ReadonlyMap<LaneName, QueueHold>,
): readonly LaneView[] {
  const { doc, live } = view
  return readLaneNames(doc).map(name => {
    const tip = readLaneTip(doc, name)
    const running = readRunning(live, name)
    const queue = queuedOn(cards, name)
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

/** The document a record's home names (ADR-0063). */
export type HomeDoc<H extends Home> = H extends "root"
  ? RootDocHandle
  : SessionDocHandle

/**
 * Every record `spec` describes, by its address (ADR-0062), from the
 * document its home names. Each named reader below is this, for one record.
 */
export const readRecords = <R, K extends string, H extends Home>(
  doc: HomeDoc<H>,
  spec: RecordSpec<R, K, H>,
): ReadonlyMap<K, R> => recordsOf(spec, readValues(doc, spec.namespace))

/** Every root's directory record (`pinetrie.root`, ADR-0063), by its id. */
export const readRoots = (
  doc: SessionDocHandle,
): ReadonlyMap<RootId, RootRecord> => readRecords(doc, ROOT)

/** Every lane the agent is replying on, in any root, and the root it is in. */
export function readRunningLanes(
  session: SessionDocHandle,
  live: LiveDocHandle,
): readonly { readonly lane: LaneName; readonly root: RootId }[] {
  return [...readLaneRecords(session).values()]
    .filter(r => readRunning(live, r.lane))
    .map(r => ({ lane: r.lane, root: r.root }))
}

/**
 * `read`, returning its last result for a document while a new one is
 * `same`. Kyneta gives a record a new identity on every write, the same
 * value written again included, and a memo or `React.memo` keyed on a read
 * skips only while the read keeps its identity (S59).
 */
function keptWhileSame<D extends object, T>(
  read: (doc: D) => T,
  same: (a: T, b: T) => boolean,
): (doc: D) => T {
  const last = new WeakMap<D, T>()
  return doc => {
    const now = read(doc)
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
 * session's other records, the directory's among them, change far more often
 * (ADR-0063).
 */
export const readParticipantNames = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<WriterId, string> =>
    new Map(
      [...readRecords(doc, PARTICIPANT).values()].map(r => [r.writer, r.name]),
    ),
  sameMap,
)

/**
 * Every participant's display name, guests included: the list a mention
 * resolves against (`address`), and the names the screen shows. A writer is
 * found in `index`, else in any root's directory record, so one who wrote
 * only in a root not loaded still counts (ADR-0063).
 */
export const readParticipants = (
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly string[] =>
  participantsIn(readParticipantNames(doc), index, readRoots(doc))

/** `readParticipants` over what a reader already holds. Pure. */
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
 * value. A person here from two seats (ADR-0037) appears twice.
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
 * Each followed thread end's root entry (ADR-0063), from the column that
 * reports it: what a window that does not hold the root opens it by. Kept
 * while unchanged, as `presenceField`'s reads are.
 */
export const readReadingRoots = keptWhileSame(
  (doc: PresenceDocHandle): ReadonlyMap<EntryId, EntryId> => {
    const roots = doc.readingRoot()
    const now = new Map<EntryId, EntryId>()
    for (const [key, end] of Object.entries(doc.reading())) {
      const root = roots[key]
      if (end !== null && root !== null && root !== undefined)
        now.set(entryId(end), entryId(root))
    }
    return now
  },
  sameMap,
)

/** One entry per seat typing: its writer, and the thread end. */
export const readTyping = presenceField(doc => doc.typing())

/**
 * The cards someone is typing in now (`typingIn`), from any seat: the host
 * pops none of them (ADR-0048 step 7). Kept while the same cards.
 */
export const readTypingIn = keptWhileSame(
  (doc: PresenceDocHandle): ReadonlySet<CardId> =>
    new Set(
      Object.values(doc.typingIn()).flatMap(card =>
        card === null ? [] : [cardId(card)],
      ),
    ),
  (a, b) => a.size === b.size && [...a].every(c => b.has(c)),
)

/** Whether two holds say the same: who, and since when. */
const sameHolds = (
  a: ReadonlyMap<LaneName, QueueHold>,
  b: ReadonlyMap<LaneName, QueueHold>,
): boolean =>
  a.size === b.size &&
  [...a].every(([lane, h]) => {
    const o = b.get(lane)
    return o !== undefined && o.by === h.by && o.at === h.at
  })

/**
 * Each held queue (`pinetrie.queue-hold`, ADR-0048 step 7), by lane. The same
 * map while the holds are, since every session write wakes it.
 */
export const readQueueHolds = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<LaneName, QueueHold> =>
    readRecords(doc, QUEUE_HOLD),
  sameHolds,
)

/** Every seat the host has seen (`pinetrie.seat`), first seen first. */
export const readSeats = (doc: SessionDocHandle): readonly SeatRecord[] =>
  [...readRecords(doc, SEAT).values()].sort((a, b) => a.at - b.at)

// Each stored card row as last decoded. Kyneta gives an unchanged `json`
// row the same object across writes, so an unchanged card keeps its record
// object, and a change to one card redraws only what shows it (S54).
const decodedRows = new WeakMap<object, CardRecord | null>()

const decodeRow = (id: string, row: object): CardRecord | null => {
  const was = decodedRows.get(row)
  if (was !== undefined && (was === null || was.id === id)) return was
  const card = decodeCard(id, row) ?? null
  decodedRows.set(row, card)
  return card
}

/**
 * Every card's record (ADR-0059), oldest first (ids are uuidv7), from the
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

/** The places document's `rev`: raised with every write (ADR-0059). */
export const readPlacesRev = (places: PlacesDocHandle): number => places.rev()

/** The session's workflow (`pinetrie.workflow`, ADR-0085), or null before a host wrote it. */
export const readWorkflow = (doc: SessionDocHandle): Workflow | null =>
  readRecords(doc, WORKFLOW).get(WORKFLOW_KEY) ?? null

/** Each root's place on the board (`pinetrie.board`, ADR-0085), by its id. */
export const readBoardPlaces = (
  doc: SessionDocHandle,
): ReadonlyMap<RootId, BoardPlace> => readRecords(doc, BOARD)

/**
 * The roots in the closed workflow state, archived (ADR-0029, ADR-0085), by
 * id; none before a host wrote the workflow. The same map while the same
 * roots are archived by the same writers at the same times: every write to
 * the session's values wakes it, the directory's included.
 */
export const readArchived = keptWhileSame(
  (doc: SessionDocHandle): ReadonlyMap<RootId, ArchivedRoot> => {
    const workflow = readWorkflow(doc)
    return workflow === null
      ? new Map()
      : archivedOf(workflow, readBoardPlaces(doc))
  },
  (a, b) =>
    a.size === b.size &&
    [...a].every(([k, v]) => {
      const w = b.get(k)
      return w !== undefined && w.by === v.by && w.at === v.at
    }),
)

/** Every entry's mark (`pinetrie.mark`, ADR-0045), keyed by entry: a root's titles its tab. */
export const readMarks = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, MarkRecord> => readRecords(doc, MARK)

/** Each ask's digest (`pinetrie.digest`, ADR-0056), by its prompt. */
export const readDigests = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, DigestRecord> => readRecords(doc, DIGEST)

/** Who stopped each ask (`pinetrie.stop`, ADR-0056), by its prompt. */
export const readStops = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, StopRecord> => readRecords(doc, STOP)

/** Each thread's last run's verdict (`pinetrie.verdict`, ADR-0077), by lane. */
/** Every card's history (`pinetrie.card-history`, ADR-0048 step 6), by card. */
export const readCardHistories = (
  doc: SessionDocHandle,
): ReadonlyMap<CardId, CardHistoryRecord> => readRecords(doc, CARD_HISTORY)

/** Every trace (`pinetrie.trace`, ADR-0048), by id. */
export const readTraces = (
  doc: SessionDocHandle,
): ReadonlyMap<string, TraceRecord> => readRecords(doc, TRACE)

export const readVerdicts = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, VerdictRecord> => readRecords(doc, VERDICT)

// ── where lanes work (ADR-0032, ADR-0033) ─────────────────────────────────

/** Every lane's record (`pinetrie.lane`): where it works, by lane. */
export const readLaneRecords = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, LaneRecord> => readRecords(doc, LANE)

/** Every revision record (`pinetrie.revision`), by the entry it is at. */
export const readRevisions = (
  doc: RootDocHandle,
): ReadonlyMap<EntryId, RevisionRecord> => readRecords(doc, REVISION)

/** Each lane's offer in your repo (ADR-0038), by lane. */
export const readOffers = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, OfferRecord> => readRecords(doc, OFFER)

/** The integration line as the host last read it (ADR-0060); null before it wrote one. */
export const readLine = (doc: SessionDocHandle): LineRecord | null =>
  readRecords(doc, LINE).get(LINE_KEY) ?? null

/** Each lane's base as its history says it (ADR-0060), by lane. */
export const readBases = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, BaseRecord> => readRecords(doc, BASE)

/** Each lane's name (`pinetrie.name`, ADR-0039), by lane. */
export const readNames = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, ThreadName> =>
  new Map([...readRecords(doc, NAME).values()].map(r => [r.lane, r.name]))

/** Each thread's banner (`pinetrie.banner`), by lane. */
export const readBanners = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, BannerRecord> => readRecords(doc, BANNER)

/** A lane as people read it (`threadNameOf`). */
export const readThreadName = (doc: SessionDocHandle, lane: LaneName): string =>
  threadNameOf(readNames(doc), lane)

/** What the host found where it runs (`pinetrie.project`); null with no tools. */
export const readProject = (doc: SessionDocHandle): ProjectRecord | null =>
  readRecords(doc, PROJECT).get(PROJECT_KEY) ?? null

/** The commands the host's pi loaded (ADR-0036); none before a host wrote them. */
export const readCommands = (
  doc: SessionDocHandle,
): readonly CommandSummary[] =>
  readRecords(doc, COMMANDS).get(COMMANDS_KEY)?.commands ?? []

/**
 * Whether a send's thread works, or will work, in its own copy: its lane is
 * one of its own, or the lane the send would create would be. Paths to your
 * working copy, and to granted host paths, are then written as the lane sees
 * them (ADR-0034, ADR-0036). A lane of its own where the host has no lanes
 * of their own now works directly, so it is not.
 */
export function worksOwn(
  view: Pick<RootView, "doc" | "session">,
  index: TreeIndex,
  send: {
    readonly lane: ThreadLane
    /** The thread's end: where a reply would create its lane. */
    readonly end: Position
    readonly mode: PlanMode
    /** Where a branch would start. */
    readonly at: Position
    readonly work: WorkSetting | null
  },
): boolean {
  if (readProject(view.session)?.kind !== "lanes") return false
  if (send.lane.kind === "lane" && send.mode !== "branch")
    return (
      readLaneRecords(view.session).get(send.lane.name)?.work?.kind === "own"
    )
  return (
    workAt(view, index, send.mode === "branch" ? send.at : send.end, send.work)
      .work?.kind === "own"
  )
}

/**
 * Where a lane created at `at` would work, and the files it would start
 * from: the send's choice, else the lane above, else the project's default.
 * The composer shows this, and the host creates the lane by it.
 */
export function workAt(
  view: Pick<RootView, "doc" | "session">,
  index: TreeIndex,
  at: Position,
  choice: WorkSetting | null,
): { readonly work: WorkSetting | null; readonly above: Above } {
  const above = nearestRevision(index, readRevisions(view.doc), at)
  const work = workFor({
    choice,
    above: above.lane,
    lanes: readLaneRecords(view.session),
    project: readProject(view.session),
  })
  return { work, above }
}

// --- blobs (ADR-0042) ---------------------------------------------------------

/**
 * Every blob something still shows: each chat's images, each tool result's
 * (ADR-0051), each `/blob/` image in the texts people type, every card's
 * (ADR-0048), queued ones among them, and each thread's banner (ADR-0050).
 * A card holds what a composer has typed, pasted images included, so the
 * caller passes every text, not only those it has loaded. Pure.
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
 * and every banner.
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
  return shas
}

/**
 * A root's directory record, read from its document (ADR-0063): its first
 * message and that message's first line, its title, its messages, newest
 * entry and writers (`summarizeRoots`), each thread's writers on its path
 * (ADR-0077), its chats that name someone, and every image it shows. What
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
      : [{ id: e.id, by: m.writer, text }]
  })
  return {
    root,
    entry,
    first,
    firstLine: firstLineOf(index, first),
    title: entry === null ? null : (readMarks(doc).get(entry)?.title ?? null),
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
 * only a composer holds. Pure.
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
