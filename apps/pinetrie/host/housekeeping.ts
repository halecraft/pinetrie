// host/housekeeping — what the host does between runs besides draining:
// compact the session (ADR-0023), delete images nothing shows (ADR-0042),
// retire histories of moves no one will undo again (ADR-0066), and delete
// holds on queues nobody can use (ADR-0048 step 7).

import type { Exchange, Store } from "@kyneta/exchange"
import {
  type BlobStore,
  MOVES_DOC_PREFIX,
  type RootId,
  rootDocId,
} from "@pinetrie/core"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import {
  planSweep,
  readArchived,
  readLaneRecords,
  readPlaces,
  readQueueHolds,
  readReferencedBlobs,
  readRoots,
} from "@pinetrie/reads"
import {
  deleteRecord,
  planHistorySweep,
  planHoldSweep,
  QUEUE_HOLD,
} from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { MoveHistories } from "./move-history.ts"
import type { Records } from "./records.ts"

/**
 * The documents a compaction replaces with what they hold now: `roots`',
 * whose lanes ran, and the session's, the places and `pinetrie:live`, which
 * every run writes (ADR-0063). Pure.
 */
export const planCompaction = (
  roots: ReadonlySet<RootId>,
): readonly string[] => [
  ...[...roots].sort().map(rootDocId),
  SESSION_DOC_ID,
  PLACES_DOC_ID,
  LIVE_DOC_ID,
]

/**
 * Replace the store's records with each document `planCompaction` names as
 * it stands, which also trims each `json` one's in-memory op log (ADR-0023,
 * ADR-0059, ADR-0063). The places are Yjs (ADR-0066): their storage is
 * compacted, and nothing in memory is trimmed (S90). The host writes them
 * all alone. Only those: each
 * client's
 * command Line is stored too, but half of it is the client's to write, and
 * Kyneta cannot compact a replica of a document another peer writes. Its
 * pruning should compact it; that is upstream (S25 addendum). A card's text
 * is Yjs, which Kyneta cannot compact live (S24).
 */
export async function compactAfter(
  exchange: Exchange,
  roots: ReadonlySet<RootId>,
): Promise<void> {
  for (const id of planCompaction(roots)) await exchange.compact(id)
}

/**
 * Delete the images nothing shows any more: gather every card's text
 * (`CardPort.texts` of the cards `places` holds), then the store's list and the session's references
 * (`readReferencedBlobs`: roots' images, banners and people's pictures)
 * with no await between them, `planSweep`, delete.
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
  const ids = readPlaces(input.basics.places).map(c => c.id)
  const texts = (await input.texts(ids)).map(t => t.text)
  const doomed = planSweep({
    stored: blobs.list(),
    referenced: readReferencedBlobs(doc, texts),
    now: input.basics.now(),
    grace: input.grace,
  })
  if (doomed.length === 0) return
  blobs.delete(doomed)
  log(`[host] deleted ${doomed.length} unreferenced image(s)`)
}

/**
 * Retire the histories of moves no one will undo again (ADR-0066): gather
 * the stored `moves:` documents, the directory and the archive, plan
 * (`planHistorySweep`), then destroy each. `startup` adds those of a root the
 * directory does not name, which only a starting host can know are dead.
 */
export async function sweepHistories(input: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly store: Pick<Store, "listDocIds">
  readonly histories: Pick<MoveHistories, "retire">
  readonly startup: boolean
}): Promise<void> {
  const { session, log, now } = input.basics
  // gather
  const stored: string[] = []
  for await (const id of input.store.listDocIds(MOVES_DOC_PREFIX))
    stored.push(id)
  // plan
  const retired = planHistorySweep({
    stored,
    roots: readRoots(session),
    archived: readArchived(session),
    now: now(),
    startup: input.startup,
  })
  // execute
  if (retired.length === 0) return
  await input.histories.retire(retired)
  log(`[host] retired ${retired.length} history(ies) of moves`)
}

/**
 * Delete the holds on queues nobody can use (ADR-0048 step 7): gather the
 * holds, each lane's root and the roots in the closed state (ADR-0112), plan (`planHoldSweep`), then
 * delete them in one write. Archiving is refused while cards are queued, so
 * a hold swept holds nothing.
 */
export async function sweepHolds(input: {
  readonly basics: Pick<Basics, "session" | "log">
  readonly records: Pick<Records, "writeValues">
}): Promise<void> {
  const { session, log } = input.basics
  // gather
  const lanes = readLaneRecords(session)
  const archived = readArchived(session)
  // plan
  const swept = planHoldSweep({
    holds: readQueueHolds(session),
    rootOf: lane => lanes.get(lane)?.root ?? null,
    archived: root => archived.has(root),
  })
  // execute
  if (swept.length === 0) return
  await input.records.writeValues(
    swept.map(lane => deleteRecord(QUEUE_HOLD, lane)),
  )
  log(`[host] swept ${swept.length} hold(s) on queues nobody can use`)
}
