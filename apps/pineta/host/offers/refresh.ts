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
import { type RootDocHandle, readLaneTip } from "@pineta/schema"
import { executeOffer } from "./execute.ts"
import { offerRecord, planOfferEffects } from "./plan.ts"
import type { OfferPlace, OfferState, Placed } from "./state.ts"

/**
 * An offer's line until an agent describes it: the thread's name and its
 * own first message, the first prompt its lane ran (ADR-0039).
 */
export function wipLine(
  doc: RootDocHandle | null,
  lane: LaneName,
  name: ThreadName,
): string {
  if (doc === null) return wipDescription(name, "")
  const index = readTreeIndex(doc)
  const tip = readLaneTip(doc, lane)
  const first = firstPromptOf(index, readRevisions(doc), lane, tip)
  const text = projectTranscript(index, tip).find(m => m.id === first)?.text
  return wipDescription(name, text ?? "")
}

export interface Refresh {
  /**
   * Abandon the offer's revisions (`changes`), then build a new one from
   * `sources` (the lane's tip, or a stack's revisions) under the lane's
   * name; their messages get the host's trailers and the offer's ledger
   * (`offerMessage`).
   */
  rebuild(
    lane: LaneName,
    name: ThreadName,
    place: Placed,
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
  const { session, docs, log } = basics
  /** A lane's tip, from its root's document; "" for none. */
  const tipOf = (lane: LaneName): string => {
    const doc = docs.docOfLane(lane)
    return (doc === null ? null : readLaneTip(doc, lane)) ?? ""
  }

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
    place: Placed,
    sources: readonly OfferSource[],
  ): Promise<void> {
    const at = {
      lane,
      name,
      entry: tipOf(lane),
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
    place: Placed,
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
    place: Placed,
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
      `[host] ${readThreadName(session, lane)}: your edit and the host's crossed; kept yours`,
    )
    await record(lane, name, place, await readAt(name, place.target))
  }

  async function refresh(lane: LaneName): Promise<"built" | "other"> {
    // gather
    const now = await state.refreshNow(lane)
    if (now === null) return "other"
    const { name, place, facts } = now
    const { offer } = facts
    // plan
    const planned = planRefresh(facts)
    const effects = planOfferEffects(planned, {
      root,
      place,
      wip: wipLine(docs.docOfLane(lane), lane, name),
      trailers: { lane, name, entry: tipOf(lane) },
      offer,
    })
    // execute: with no place, `planOfferEffects` plans none of the steps
    // that need one.
    const placed = <T>(go: (at: Placed) => Promise<T>): Promise<T> =>
      place === null
        ? Promise.reject(new Error(`${lane}: an offer step needs a place`))
        : go(place)
    return executeOffer(
      {
        run: executeOnHost,
        build: sources => placed(at => build(lane, name, at, sources)),
        read: () => placed(at => readAt(name, at.target)),
        record: read => placed(at => record(lane, name, at, read)),
        repair: changes => placed(at => repair(lane, name, at, changes)),
        remove: () => state.remove(lane),
      },
      effects,
      offer,
    )
  }

  return { rebuild, record, refresh }
}
