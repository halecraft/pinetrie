// host/offers/refresh — building an offer, writing its record, and what a
// trigger does to it: gather (`offerNow`), `planRefresh`,
// `planOfferEffects`, execute. The record is written from the repo after
// each step, never read back to decide.

import {
  type CommitId,
  firstPromptOf,
  type LaneName,
  type OfferInRepo,
  projectTranscript,
  type ThreadName,
} from "@pineta/core"
import {
  executeOnHost,
  hostCommitIn,
  type OfferSource,
  offerBookmark,
  planAbandonOffer,
  planOffer,
  planRepair,
  readOffer,
  yourEditsIn,
} from "@pineta/lanes"
import { offerMessage, planRefresh, wipDescription } from "@pineta/marginalia"
import { readRevisions, readThreadName, readTreeIndex } from "@pineta/reads"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"
import { executeOffer } from "./execute.ts"
import { offerRecord, planOfferEffects } from "./plan.ts"
import type { OfferPlace, OfferState } from "./state.ts"

/**
 * An offer's line until an agent describes it: the thread's name and its
 * own first message, the first prompt its lane ran (ADR-0039).
 */
export function wipLine(
  doc: SessionDocHandle,
  lane: LaneName,
  name: ThreadName,
): string {
  const index = readTreeIndex(doc)
  const tip = readLaneTip(doc, lane)
  const first = firstPromptOf(index, readRevisions(doc), lane, tip)
  const text = projectTranscript(index, tip).find(m => m.id === first)?.text
  return wipDescription(name, text ?? "")
}

export interface Refresh {
  /**
   * A new offer from `sources` (the lane's tip, or a stack's revisions) on
   * `start`, under the lane's name; their messages get the host's trailers
   * and the offer's ledger (`offerMessage`).
   */
  build(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace & { readonly target: CommitId },
    sources: readonly OfferSource[],
  ): Promise<void>
  /** Abandon the offer's revisions (`changes`), then build anew. */
  rebuild(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace & { readonly target: CommitId },
    changes: readonly string[],
    sources: readonly OfferSource[],
  ): Promise<void>
  /** Write the offer's record from the offer as your repo holds it. */
  record(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace,
    offer: OfferInRepo | null,
  ): Promise<void>
  /** What a trigger does to one lane's offer: "built" when its content changed. */
  refresh(lane: LaneName): Promise<"built" | "other">
}

export function createRefresh(state: OfferState): Refresh {
  const { root, ops, basics } = state
  const { doc, log } = basics

  /** The record is the page's; a divergent offer is recorded once repaired. */
  async function record(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace,
    offer: OfferInRepo | null,
  ): Promise<void> {
    if (offer === null || offer.kind === "divergent") return
    await state.write(
      offerRecord({
        lane,
        name,
        offer,
        place,
        yourEdits: await yourEditsIn(ops, offer.files),
        now: basics.now(),
      }),
    )
  }

  const readAt = (name: ThreadName, target: CommitId) =>
    readOffer(ops, { name, target })

  async function build(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace & { readonly target: CommitId },
    sources: readonly OfferSource[],
  ): Promise<void> {
    const at = {
      lane,
      name,
      entry: readLaneTip(doc, lane) ?? "",
      ledger: { source: place.tip, start: place.start },
    }
    await executeOnHost(
      planOffer({
        root,
        name,
        start: place.start,
        sources: sources.map(source => ({
          ...source,
          description: offerMessage(source.description, at),
        })),
        target: place.target,
        nonce: `pineta-offer-${crypto.randomUUID()}`,
      }),
    )
    await record(lane, name, place, await readAt(name, place.target))
  }

  async function rebuild(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace & { readonly target: CommitId },
    changes: readonly string[],
    sources: readonly OfferSource[],
  ): Promise<void> {
    await executeOnHost(planAbandonOffer(root, changes))
    await build(lane, name, place, sources)
  }

  /** Each revision repaired (S48 item 18), then the record. */
  async function repair(
    lane: LaneName,
    name: ThreadName,
    place: OfferPlace & { readonly target: CommitId },
    changes: readonly string[],
  ) {
    const last = changes.length - 1
    for (const [i, change] of changes.entries()) {
      const split = await hostCommitIn(ops, change)
      if (split === null) continue
      await executeOnHost(
        planRepair({
          root,
          bookmark: offerBookmark(name),
          ...split,
          top: i === last,
        }),
      )
    }
    log(
      `[host] ${readThreadName(doc, lane)}: your edit and the host's crossed; kept yours`,
    )
    await record(lane, name, place, await readAt(name, place.target))
  }

  async function refresh(lane: LaneName): Promise<"built" | "other"> {
    // gather
    const now = await state.offerNow(lane)
    // No tip yet, no name, or a WIP gone without landing: nothing moves
    // (ADR-0060).
    if (now === null || now.name === undefined) return "other"
    const { place, name, offer } = now
    const { tip, start, target } = place
    if (target === null) return "other"
    const at = { ...place, target }
    // plan
    const planned = planRefresh({ tip, start, offer })
    const effects = planOfferEffects(planned, {
      root,
      tip,
      start,
      target,
      wip: wipLine(doc, lane, name),
      trailers: { lane, name, entry: readLaneTip(doc, lane) ?? "" },
      offer,
    })
    // execute
    return executeOffer(
      {
        run: executeOnHost,
        build: sources => build(lane, name, at, sources),
        read: () => readAt(name, target),
        record: read => record(lane, name, place, read),
        repair: changes => repair(lane, name, at, changes),
        remove: () => state.agent().removeOffer(lane),
      },
      effects,
      offer,
    )
  }

  return { build, rebuild, record, refresh }
}
