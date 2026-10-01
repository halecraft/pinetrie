// host/housekeeping — what the host does between runs besides draining:
// compact the session (ADR-0023) and delete images nothing shows (ADR-0042).

import type { Exchange } from "@kyneta/exchange"
import type { BlobStore } from "@pineta/core"
import { SESSION_DOC_ID } from "@pineta/protocol/messages"
import { planSweep, readReferencedBlobs } from "@pineta/reads"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"

/**
 * Replace the store's records with the session as it stands, which also
 * trims the in-memory op log (ADR-0023). The session only: each client's
 * command Line is stored too, but half of it is the client's to write, and
 * Kyneta cannot compact a replica of a document another peer writes. Its
 * pruning should compact it; that is upstream (S25 addendum). A card's text
 * is Yjs, which Kyneta cannot compact live (S24).
 */
export const compactSession = (exchange: Exchange): Promise<void> =>
  exchange.compact(SESSION_DOC_ID)

/**
 * Delete the images nothing shows any more: gather every card's text
 * (`CardPort.texts`), then the store's list and the session's references
 * with no await between them, `planSweep`, delete.
 */
export async function sweepBlobs(input: {
  readonly basics: Pick<Basics, "doc" | "log" | "now">
  readonly blobs: BlobStore
  /** How long an image nothing shows is kept, from its upload or last touch. */
  readonly grace: number
  readonly texts: CardPort["texts"]
}): Promise<void> {
  const { doc, log } = input.basics
  const { blobs } = input
  const texts = (await input.texts()).map(t => t.text)
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
