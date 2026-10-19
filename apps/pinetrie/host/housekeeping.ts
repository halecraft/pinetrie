// host/housekeeping — what the host does between runs besides draining: compact
// the session, delete images nothing shows, retire histories of moves no one
// will undo again, and delete holds on queues nobody can use, and delete
// trashed cards no one brought back in a week, a deleted thread's lane with it.

import type { Store } from "@kyneta/exchange"
import {
  type BlobStore,
  type EntryId,
  MOVES_DOC_PREFIX,
  type RevisionRecord,
  type Sha256,
} from "@pinetrie/core"
import {
  planSweep,
  readArchived,
  readCanvases,
  readCardHistories,
  readLaneRecords,
  readPlaces,
  readQueueHolds,
  readReferencedBlobs,
  readRevisions,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  deleteRecord,
  planHistorySweep,
  planHoldSweep,
  planLanesGone,
  planTrashSweep,
  QUEUE_HOLD,
  TRASH_KEEP_MS,
} from "@pinetrie/rules"
import { cardBlobs, isTextCard } from "@pinetrie/threads"
import { type Basics, failed, type LeaseBasics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { MoveHistories } from "./move-history.ts"
import type { Places } from "./places.ts"
import type { Provenance } from "./provenance.ts"
import type { Records } from "./records.ts"
import type { LaneWork } from "./work/index.ts"

/**
 * When the host sweeps unused resources: once at its start (after
 * `recover`), and at each upkeep that follows a settle.
 */
export type SweepTime = "start" | "upkeep"

/** One sweep: images, histories of moves, holds, the trash, or traces. */
export type Sweep = "blobs" | "histories" | "holds" | "trash" | "traces"

/**
 * The sweeps at `when`, in the order they run. Only an upkeep sweeps
 * images: a start's settle queues an upkeep that does.
 */
export const planSweeps = (when: SweepTime): readonly Sweep[] =>
  when === "start"
    ? ["histories", "holds", "trash", "traces"]
    : ["blobs", "histories", "holds", "trash", "traces"]

export interface SweepDeps {
  readonly basics: Pick<
    LeaseBasics,
    "session" | "places" | "leases" | "log" | "now"
  >
  readonly blobs: BlobStore
  /** How long an image nothing shows is kept, from its upload or last touch. */
  readonly grace: number
  readonly texts: CardPort["texts"]
  readonly store: Pick<Store, "listDocIds">
  readonly histories: Pick<MoveHistories, "retire">
  readonly records: Pick<Records, "writeValues">
  readonly placesWriter: Places
  readonly work: Pick<LaneWork, "teardown" | "destination" | "forgetReaders">
  readonly provenance: Pick<Provenance, "sweep">
}

/**
 * Carry out `planSweeps(when)` in one step of the documents' keeper, which
 * the caller holds: the trash's change of the places needs one. A failed
 * image sweep is logged and the others go on; any other failure ends the
 * sweeps, as the caller's.
 */
export async function sweepUnused(
  deps: SweepDeps,
  when: SweepTime,
): Promise<void> {
  const { basics } = deps
  for (const sweep of planSweeps(when))
    switch (sweep) {
      case "blobs":
        await sweepBlobs(deps).catch(
          failed(basics, "deleting unreferenced images"),
        )
        break
      case "histories":
        await sweepHistories({ ...deps, startup: when === "start" })
        break
      case "holds":
        await sweepHolds(deps)
        break
      case "trash":
        await sweepTrash(deps)
        break
      case "traces":
        await deps.provenance.sweep()
        break
    }
}

/**
 * Delete the blobs nothing shows or quotes any more: gather every card's text
 * (`CardPort.texts` of the cards `places` holds) and every blob a card holds
 * (`cardBlobs`: a reference's quote, an image's versions), then the store's
 * list and the session's references
 * (`readReferencedBlobs`: roots' blobs, banners and people's pictures), with
 * each one's fitted copy, with no await between them, `planSweep`, delete.
 */
export async function sweepBlobs(input: {
  readonly basics: Pick<Basics, "session" | "places" | "log" | "now">
  readonly blobs: BlobStore
  /** How long an image nothing shows is kept, from its upload or last touch. */
  readonly grace: number
  readonly texts: CardPort["texts"]
}): Promise<void> {
  const { session: doc, log } = input.basics
  const { blobs } = input
  const cards = readPlaces(input.basics.places)
  const ids = cards.filter(isTextCard).map(c => c.id)
  const texts = (await input.texts(ids)).map(t => t.text)
  // A reference's quote and an image's versions are blobs their cards hold.
  const held = cards.flatMap(cardBlobs)
  const shown = new Set([...readReferencedBlobs(doc, texts), ...held])
  // A draft names an image's original; its fitted copy is what the message
  // will show once sent.
  const referenced = new Set<Sha256>(
    [...shown].flatMap(sha => {
      const fitted = blobs.fitted(sha)
      return fitted === undefined ? [sha] : [sha, fitted.sha256]
    }),
  )
  const doomed = planSweep({
    stored: blobs.list(),
    referenced,
    now: input.basics.now(),
    grace: input.grace,
  })
  if (doomed.length === 0) return
  blobs.delete(doomed)
  log(`[host] deleted ${doomed.length} unreferenced blob(s)`)
}

/**
 * Retire the histories of moves no one will undo again: gather the stored
 * `moves:` documents, the directory and the archive, plan (`planHistorySweep`),
 * then destroy each. `startup` adds those of a root the directory does not
 * name, which only a starting host can know are dead.
 */
export async function sweepHistories(input: {
  readonly basics: Pick<Basics, "session" | "places" | "log" | "now">
  readonly store: Pick<Store, "listDocIds">
  readonly histories: Pick<MoveHistories, "retire">
  readonly startup: boolean
}): Promise<void> {
  const { session, places, log, now } = input.basics
  // gather
  const stored: string[] = []
  for await (const id of input.store.listDocIds(MOVES_DOC_PREFIX))
    stored.push(id)
  // plan
  const retired = planHistorySweep({
    stored,
    canvases: readCanvases(places),
    archived: readArchived(session, places),
    now: now(),
    startup: input.startup,
  })
  // execute
  if (retired.length === 0) return
  await input.histories.retire(retired)
  log(`[host] retired ${retired.length} history(ies) of moves`)
}

/**
 * Delete the holds on queues nobody can use: gather the holds, each lane's root
 * and the roots in the archive, plan (`planHoldSweep`), then delete them in one
 * write. Archiving is refused while cards are queued, so a hold swept holds
 * nothing.
 */
export async function sweepHolds(input: {
  readonly basics: Pick<Basics, "session" | "log" | "places">
  readonly records: Pick<Records, "writeValues">
}): Promise<void> {
  const { session, places, log } = input.basics
  // gather
  const cards = readPlaces(places)
  const archived = readArchived(session, places)
  // plan
  const swept = planHoldSweep({
    holds: readQueueHolds(session),
    whereIs: lane => {
      const card = cards.find(c => c.id === lane)
      return card?.place.kind === "canvas"
        ? card.place.canvas
        : card?.place.kind === "inventory"
          ? "inventory"
          : null
    },
    archived: canvas => archived.has(canvas),
  })
  // execute
  if (swept.length === 0) return
  await input.records.writeValues(
    swept.map(lane => deleteRecord(QUEUE_HOLD, lane)),
  )
  log(`[host] swept ${swept.length} hold(s) on queues nobody can use`)
}

/**
 * Delete the trashed cards past their deadline, and every card on a surface one
 * owns (`planTrashSweep`): gather the places, the cards' histories and, for the
 * threads among them, their lanes of their own with their roots' revisions and
 * trees; plan; then delete each record, then its text, then the deleted
 * threads' lanes, as an archive's teardown removes them (`planLanesGone`),
 * and the lanes from the shared files' lineages they read. Their messages
 * stay in their roots. The records, their texts and their
 * histories go in one change of the host's.
 */
export async function sweepTrash(input: {
  readonly basics: Pick<
    LeaseBasics,
    "session" | "places" | "leases" | "log" | "now"
  >
  readonly placesWriter: Places
  readonly work: Pick<LaneWork, "teardown" | "destination" | "forgetReaders">
}): Promise<void> {
  const { session, places, leases, log, now } = input.basics
  // gather
  const cards = readPlaces(places)
  const histories = readCardHistories(session)
  const swept = planTrashSweep({
    cards,
    histories,
    now: now(),
    keepMs: TRASH_KEEP_MS,
  })
  if (swept.cards.length === 0) return
  const records = readLaneRecords(session)
  const own =
    input.work.destination === null
      ? []
      : swept.threads.filter(t => (records.get(t)?.history ?? null) !== null)
  const threads = readThreads(session)
  const revisions = new Map<EntryId, RevisionRecord>()
  const trees = []
  for (const root of new Set(own.flatMap(t => threads.get(t)?.root ?? []))) {
    await using held = leases.root(root)
    const doc = await held.ready
    trees.push(readTreeIndex(doc))
    for (const [entry, r] of readRevisions(doc)) revisions.set(entry, r)
  }
  // plan
  const teardown = planLanesGone(own, revisions, trees)
  // execute
  await input.placesWriter.change({ kind: "host" }, open =>
    open.apply(swept.cards.map(id => ({ kind: "remove", id }))),
  )
  await input.work.teardown(teardown)
  await input.work.forgetReaders(new Set(swept.threads))
  log(`[host] deleted ${swept.cards.length} card(s) trashed over a week ago`)
}
