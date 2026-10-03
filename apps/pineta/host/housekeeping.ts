// host/housekeeping — what the host does between runs besides draining:
// compact the session (ADR-0023) and delete images nothing shows (ADR-0042).

import type { Exchange } from "@kyneta/exchange"
import { type BlobStore, type RootId, rootDocId } from "@pineta/core"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { planSweep, readPlaces, readReferencedBlobs } from "@pineta/reads"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"

/**
 * The documents a compaction replaces with what they hold now: `roots`',
 * whose lanes ran, and the session's, the places and `pineta:live`, which
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
 * it stands, which also trims each one's in-memory op log (ADR-0023,
 * ADR-0059, ADR-0063). The host writes them all alone. Only those: each
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
