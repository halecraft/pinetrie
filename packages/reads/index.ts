// reads — what the session document says, read once, for the host and the
// client alike.
//
// The composer promises "send" or "queue" from the same facts the host then
// decides from. If the two read those facts separately, the promise holds only
// while two copies stay in step, which is the drift this project keeps
// meeting. So both read here. `packages/client/projection.ts` gathers these
// for the page; a stream's text is `readStreams`, in `@pineta/schema`.
//
// Pure reads of a document handle: no subscription and no pi. The only caches
// are keyed by objects Kyneta keeps while their content is unchanged, so a hit
// returns what reading again would.

import {
  type Above,
  type AgentMessageLike,
  type AgentRun,
  type ArchiveRecord,
  agentActivity,
  type BannerRecord,
  type CardRecord,
  type CommandSummary,
  type EntryLike,
  type HaveRecord,
  indexTree,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type MarkRecord,
  messageImages,
  nearestRevision,
  type OfferRecord,
  type PlanMode,
  type Position,
  type ProjectRecord,
  promptOf,
  type RevisionRecord,
  type SeatRecord,
  type Sha256,
  type StopRecord,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  type WorkSetting,
  type WriterId,
  workFor,
} from "@pineta/core"
import {
  ARCHIVE_NAMESPACE,
  archiveRecords,
  BANNER_NAMESPACE,
  bannerRecords,
  COMMANDS_NAMESPACE,
  commandsRecord,
  DIGEST_NAMESPACE,
  type DigestRecord,
  decodeCard,
  decodeChat,
  digestRecords,
  HAVE_NAMESPACE,
  haveRecords,
  LANDING_NAMESPACE,
  LANE_NAMESPACE,
  landingRecords,
  laneRecords,
  MARK_NAMESPACE,
  markRecords,
  NAME_NAMESPACE,
  nameRecords,
  OFFER_NAMESPACE,
  offerRecords,
  PARTICIPANT_NAMESPACE,
  PROJECT_NAMESPACE,
  participantNames,
  participants,
  pastedImages,
  projectRecord,
  queuedOn,
  REVISION_NAMESPACE,
  renderableMessage,
  revisionRecords,
  SEAT_NAMESPACE,
  STOP_NAMESPACE,
  seatRecords,
  stopRecords,
} from "@pineta/marginalia"
import {
  type CardsDocHandle,
  type PresenceDocHandle,
  readActiveRun,
  readEntries,
  readLaneNames,
  readLaneTip,
  readValues,
  rowMessage,
  type SessionDocHandle,
  type StoredEntryRow,
  writerOfKey,
} from "@pineta/schema"

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

function renderableEntry(row: StoredEntryRow): EntryLike {
  const known = entryOfRow.get(row)
  if (known !== undefined) return known
  const entry: EntryLike = Object.freeze({
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    message: renderableMessage(rowMessage(row)),
  })
  entryOfRow.set(row, entry)
  return entry
}

function renderableEntries(
  rows: Readonly<Record<string, StoredEntryRow>>,
): Record<string, EntryLike> {
  const out: Record<string, EntryLike> = {}
  for (const [id, row] of Object.entries(rows)) out[id] = renderableEntry(row)
  return out
}

/**
 * Stored rows -> the shape the projections read (ADR-0015). `message` is pi's
 * variant data, lifted by `rowMessage`; a human's chat is decoded here, by
 * `renderableMessage`, into role `chat` with its author and writer. An
 * unchanged row gives the same entry, frozen.
 */
export const readRenderableEntries = (
  doc: SessionDocHandle,
): Record<string, EntryLike> => renderableEntries(readEntries(doc))

/**
 * The tree, indexed once per change of its entries (`indexTree`): a document
 * change that touches no entry returns the same index. Every caller shares it,
 * so none may sort or change its lists in place.
 */
export function readTreeIndex(doc: SessionDocHandle): TreeIndex {
  const rows = readEntries(doc)
  const known = indexOfEntries.get(rows)
  if (known !== undefined) return known
  const index = indexTree(renderableEntries(rows))
  indexOfEntries.set(rows, index)
  return index
}

/** Whether a lane is running now: the session records its active run. */
export const readRunning = (doc: SessionDocHandle, lane: LaneName): boolean =>
  readActiveRun(doc, lane) !== undefined

/**
 * Who asked the run that wrote `tip`: the writer of its prompt
 * (`promptOf`, ADR-0056), when a person's message started it.
 */
function askerOf(index: TreeIndex, tip: string | null): WriterId | undefined {
  const prompt = promptOf(index, tip)
  const message = prompt === null ? undefined : index.entries[prompt]?.message
  return message?.role === "chat" ? message.writer : undefined
}

/**
 * Every thread lane: its tip, whether it runs, how many cards are queued for
 * it (ADR-0048), who holds it (for a conflict's "by"): the writer of the ask
 * it is answering (`askerOf`), or who queued its first card; and who queued
 * its last card, whom a card queued now follows. `cards` is every card's
 * record (`readCards`).
 */
export function readLanes(
  doc: SessionDocHandle,
  index: TreeIndex,
  cards: readonly CardRecord[],
): readonly LaneView[] {
  // Lane names are read from storage: branded here, the one edge they cross.
  return readLaneNames(doc).map(stored => {
    const name = stored as LaneName
    const tip = readLaneTip(doc, name)
    const running = readRunning(doc, name)
    const queue = queuedOn(cards, name)
    const asking = running ? askerOf(index, tip) : queue[0]?.place.by
    return {
      name,
      tip,
      running,
      waiting: queue.length,
      askedBy: asking ?? null,
      lastWaiting: queue.at(-1)?.place.by ?? null,
    }
  })
}

/** One lane's view, or undefined for a lane the document does not hold. */
export const readLane = (
  doc: SessionDocHandle,
  lane: LaneName,
  cards: readonly CardRecord[],
): LaneView | undefined =>
  readLanes(doc, readTreeIndex(doc), cards).find(l => l.name === lane)

/** Every lane the agent is replying on. */
export function readAgentActivity(doc: SessionDocHandle): readonly AgentRun[] {
  return agentActivity(
    readLaneNames(doc)
      .map(stored => stored as LaneName)
      .filter(lane => readRunning(doc, lane))
      .map(lane => ({ lane, tip: readLaneTip(doc, lane) })),
  )
}

/** Each writer's display name (`pineta.participant`). */
export const readParticipantNames = (
  doc: SessionDocHandle,
): ReadonlyMap<WriterId, string> =>
  participantNames(readValues(doc, PARTICIPANT_NAMESPACE))

/**
 * Every participant's display name, guests included: the list a mention
 * resolves against (`address`), and the names the screen shows.
 */
export function readParticipants(
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly string[] {
  const writers = Object.values(index.entries).flatMap(e =>
    e.message?.writer === undefined ? [] : [e.message.writer],
  )
  return participants(readParticipantNames(doc), writers)
}

/**
 * One field of the presence document: an entry per key, as its writer and
 * value. A person here from two seats (ADR-0037) appears twice.
 */
export type PresenceEntries = readonly (readonly [WriterId, string])[]

const samePairs = (a: PresenceEntries, b: PresenceEntries): boolean =>
  a.length === b.length &&
  a.every((pair, i) => pair[0] === b[i]?.[0] && pair[1] === b[i]?.[1])

/**
 * A read of one presence field's live entries. A decayed value is `null` and
 * its key stays, so nulls are skipped here, once. Every key starts with its
 * seat's `seatKey`, and the writer is what comes before the first colon
 * (`writerOfKey`).
 *
 * A write of the same value (the page's refresh) gives Kyneta's record a new
 * identity, so the last result is kept per document and returned while its
 * entries are the same: memos keyed on it then skip.
 */
function presenceField(
  field: (doc: PresenceDocHandle) => Record<string, string | null>,
): (doc: PresenceDocHandle) => PresenceEntries {
  const last = new WeakMap<PresenceDocHandle, PresenceEntries>()
  return doc => {
    const now = Object.entries(field(doc)).flatMap(([key, value]) => {
      const writer = writerOfKey(key)
      return value === null || writer === undefined
        ? []
        : [[writer as WriterId, value] as const]
    })
    const before = last.get(doc)
    if (before !== undefined && samePairs(before, now)) return before
    last.set(doc, now)
    return now
  }
}

/** One entry per open column: its writer, and the thread end it follows. */
export const readReading = presenceField(doc => doc.reading())
/** One entry per seat typing: its writer, and the thread end. */
export const readTyping = presenceField(doc => doc.typing())

/** Every seat the host has seen (`pineta.seat`), first seen first. */
export const readSeats = (doc: SessionDocHandle): readonly SeatRecord[] =>
  seatRecords(readValues(doc, SEAT_NAMESPACE))

// Each cards document's records as last decoded, by card id, with the stored
// value they came from: a Yjs read gives new objects every time, so an
// unchanged card keeps its record object only through this (S54).
const decodedCards = new WeakMap<
  object,
  Map<string, { readonly stored: string; readonly card: CardRecord }>
>()

/**
 * Every card's record (ADR-0048), oldest first (ids are uuidv7). A card that
 * does not decode is left out. An unchanged card is the same object as last
 * time, so a change to one card redraws only what shows it.
 */
export function readCards(cards: CardsDocHandle): readonly CardRecord[] {
  const before = decodedCards.get(cards) ?? new Map()
  const now = new Map<string, { stored: string; card: CardRecord }>()
  for (const [id, value] of Object.entries(cards.cards())) {
    const stored = JSON.stringify(value)
    const was = before.get(id)
    const card =
      was !== undefined && was.stored === stored
        ? was.card
        : decodeCard(id, value)
    if (card !== undefined) now.set(id, { stored, card })
  }
  decodedCards.set(cards, now)
  return [...now.keys()].sort().flatMap(id => {
    const got = now.get(id)
    return got === undefined ? [] : [got.card]
  })
}

/** Every root's archive record (`pineta.archive`, ADR-0029), keyed by root. */
export const readArchive = (
  doc: SessionDocHandle,
): ReadonlyMap<string, ArchiveRecord> =>
  archiveRecords(readValues(doc, ARCHIVE_NAMESPACE))

/** Every entry's mark (`pineta.mark`, ADR-0045), keyed by entry: a root's titles its tab. */
export const readMarks = (
  doc: SessionDocHandle,
): ReadonlyMap<string, MarkRecord> =>
  markRecords(readValues(doc, MARK_NAMESPACE))

/** Each ask's digest (`pineta.digest`, ADR-0056), by its prompt. */
export const readDigests = (
  doc: SessionDocHandle,
): ReadonlyMap<string, DigestRecord> =>
  digestRecords(readValues(doc, DIGEST_NAMESPACE))

/** Who stopped each ask (`pineta.stop`, ADR-0056), by its prompt. */
export const readStops = (
  doc: SessionDocHandle,
): ReadonlyMap<string, StopRecord> =>
  stopRecords(readValues(doc, STOP_NAMESPACE))

// ── where lanes work (ADR-0032, ADR-0033) ─────────────────────────────────

/** Every lane's record (`pineta.lane`): where it works, by lane. */
export const readLaneRecords = (
  doc: SessionDocHandle,
): ReadonlyMap<string, LaneRecord> =>
  laneRecords(readValues(doc, LANE_NAMESPACE))

/** Every revision record (`pineta.revision`), by the entry it is at. */
export const readRevisions = (
  doc: SessionDocHandle,
): ReadonlyMap<string, RevisionRecord> =>
  revisionRecords(readValues(doc, REVISION_NAMESPACE))

/** Every resolution's record (`pineta.landing`), oldest first. */
export const readLandings = (doc: SessionDocHandle): readonly LandingRecord[] =>
  landingRecords(readValues(doc, LANDING_NAMESPACE))

/** Each lane's offer in your repo (ADR-0038), by lane. */
export const readOffers = (
  doc: SessionDocHandle,
): ReadonlyMap<string, OfferRecord> =>
  offerRecords(readValues(doc, OFFER_NAMESPACE))

/** The commits you have of lanes: delivered by a take, or copies of your `@`. */
export const readHaves = (doc: SessionDocHandle): readonly HaveRecord[] =>
  haveRecords(readValues(doc, HAVE_NAMESPACE))

/** Each lane's name (`pineta.name`, ADR-0039), by lane. */
export const readNames = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, ThreadName> =>
  nameRecords(readValues(doc, NAME_NAMESPACE))

/** Each thread's banner (`pineta.banner`), by lane. */
export const readBanners = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, BannerRecord> =>
  bannerRecords(readValues(doc, BANNER_NAMESPACE))

/**
 * A lane as people read it: its name, or, before the host has named it, the
 * last eight characters of its id.
 */
export const readThreadName = (doc: SessionDocHandle, lane: LaneName): string =>
  readNames(doc).get(lane) ?? lane.slice(-8)

/** What the host found where it runs (`pineta.project`); null with no tools. */
export const readProject = (doc: SessionDocHandle): ProjectRecord | null =>
  projectRecord(readValues(doc, PROJECT_NAMESPACE))

/** The commands the host's pi loaded (ADR-0036); none before a host wrote them. */
export const readCommands = (
  doc: SessionDocHandle,
): readonly CommandSummary[] =>
  commandsRecord(readValues(doc, COMMANDS_NAMESPACE))

/**
 * Whether a send's thread works, or will work, in its own copy: its lane is
 * one of its own, or the lane the send would create would be. Paths to your
 * working copy, and to granted host paths, are then written as the lane sees
 * them (ADR-0034, ADR-0036). A lane of its own where the host has no lanes
 * of their own now works directly, so it is not.
 */
export function worksOwn(
  doc: SessionDocHandle,
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
  if (readProject(doc)?.kind !== "lanes") return false
  if (send.lane.kind === "lane" && send.mode !== "branch")
    return readLaneRecords(doc).get(send.lane.name)?.work.kind === "own"
  return (
    workAt(doc, index, send.mode === "branch" ? send.at : send.end, send.work)
      .work?.kind === "own"
  )
}

/**
 * Where a lane created at `at` would work, and the files it would start
 * from: the send's choice, else the lane above, else the project's default.
 * The composer shows this, and the host creates the lane by it.
 */
export function workAt(
  doc: SessionDocHandle,
  index: TreeIndex,
  at: Position,
  choice: WorkSetting | null,
): { readonly work: WorkSetting | null; readonly above: Above } {
  const above = nearestRevision(index, readRevisions(doc), at)
  const work = workFor({
    choice,
    above: above.lane,
    lanes: readLaneRecords(doc),
    project: readProject(doc),
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

/** `referencedBlobs` over the session as it stands, and every card's text. */
export const readReferencedBlobs = (
  doc: SessionDocHandle,
  texts: Iterable<string>,
): ReadonlySet<Sha256> =>
  referencedBlobs({
    messages: Object.values(readEntries(doc)).map(rowMessage),
    texts,
    banners: readBanners(doc).values(),
  })

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
