// host/offers/refresh — building an offer, writing its record, and what a
// trigger does to it: gather, `planRefresh`, `planOfferEffects`, execute.

import {
  type CommitId,
  firstPromptOf,
  type LaneName,
  type OfferRecord,
  projectTranscript,
  type ThreadName,
} from "@pineta/core"
import {
  changeOf,
  executeOnHost,
  hostCommitIn,
  laneTipIn,
  type OfferFacts,
  type OfferSource,
  offerBookmark,
  offerCommits,
  offerFacts,
  offerRevisions,
  planOffer,
  planRepair,
  startOfOffer,
  yourEditsIn,
} from "@pineta/lanes"
import { planRefresh, wipDescription } from "@pineta/marginalia"
import {
  readHaves,
  readRevisions,
  readThreadName,
  readTreeIndex,
} from "@pineta/reads"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"
import { executeOffer } from "./execute.ts"
import { type OfferAt, offerRecord, planOfferEffects } from "./plan.ts"
import type { OfferState } from "./state.ts"

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
   * `start`, under the lane's name.
   */
  build(
    lane: LaneName,
    name: ThreadName,
    tip: CommitId,
    start: readonly CommitId[],
    target: string,
    sources: readonly OfferSource[],
    described: boolean,
  ): Promise<void>
  /** Write the offer's record from what your repo holds now. */
  record(lane: LaneName, at: OfferAt, known?: OfferFacts): Promise<void>
  /** What a trigger does to one lane's offer: "built" when its content changed. */
  refresh(lane: LaneName): Promise<"built" | "other">
}

export function createRefresh(state: OfferState): Refresh {
  const { root, ops, basics } = state
  const { doc, log } = basics

  async function record(
    lane: LaneName,
    at: OfferAt,
    known?: OfferFacts,
  ): Promise<void> {
    const facts =
      known ??
      (await offerFacts(ops, {
        changes: at.changes,
        wrote: at.commits,
        target: at.target,
      }))
    await state.write(
      offerRecord(
        lane,
        at,
        facts,
        await yourEditsIn(ops, facts.files),
        basics.now(),
      ),
    )
  }

  async function build(
    lane: LaneName,
    name: ThreadName,
    tip: CommitId,
    start: readonly CommitId[],
    target: string,
    sources: readonly OfferSource[],
    described: boolean,
  ): Promise<void> {
    await executeOnHost(
      planOffer({
        root,
        name,
        start,
        sources,
        target,
        nonce: `pineta-offer-${crypto.randomUUID()}`,
      }),
    )
    const bookmark = offerBookmark(name)
    const commits = await offerRevisions(ops, bookmark, sources.length)
    await record(lane, {
      bookmark,
      tip,
      start,
      commits,
      changes: await Promise.all(commits.map(c => changeOf(ops, c))),
      target,
      stale: false,
      described,
      edited: false,
    })
  }

  /** Each revision of `open` repaired (S48 item 18), then its record. */
  async function repair(lane: LaneName, open: OfferRecord, at: OfferAt) {
    const last = open.host.changes.length - 1
    for (const [i, change] of open.host.changes.entries()) {
      const split = await hostCommitIn(ops, change)
      if (split === null) continue
      await executeOnHost(
        planRepair({
          root,
          bookmark: open.bookmark,
          ...split,
          top: i === last,
        }),
      )
    }
    log(
      `[host] ${readThreadName(doc, lane)}: your edit and the host's crossed; kept yours`,
    )
    await record(lane, at)
  }

  async function refresh(lane: LaneName): Promise<"built" | "other"> {
    // gather
    const name = state.nameOf(lane)
    const tip = await laneTipIn(ops, lane)
    if (tip === null || name === undefined) return "other"
    const target = await state.targetNow()
    const start = await startOfOffer(ops, {
      tip,
      target,
      haves: readHaves(doc),
    })
    const stored = state.offerOf(lane)
    const open = stored !== undefined && stored.taken === null ? stored : null
    const facts = open === null ? null : await state.factsOf(open, target)
    // An offer you abandoned, or took by hand, is gone: a new one is built.
    const live =
      open !== null && facts !== null && (facts.present || facts.divergent)
    // plan
    const planned = planRefresh({
      tip,
      start,
      offer:
        live && open !== null && facts !== null
          ? {
              size: open.size,
              taken: open.taken,
              builtFrom: open.host.tip,
              builtOn: open.host.start,
              revisions: facts.revisions,
              placed: facts.placed,
              onTarget: facts.onTarget,
              divergent: facts.divergent,
            }
          : undefined,
    })
    const effects = planOfferEffects(planned, {
      root,
      tip,
      start,
      target,
      wip: wipLine(doc, lane, name),
      open: facts === null ? null : open,
      live,
      read: facts === null ? null : facts.commits,
    })
    // execute
    return executeOffer(
      {
        run: executeOnHost,
        build: sources => build(lane, name, tip, start, target, sources, false),
        reread: async offer =>
          (await offerCommits(ops, offer.host.changes)).commits,
        record: (at, known) =>
          record(lane, at, known && facts !== null ? facts : undefined),
        repair: (offer, at) => repair(lane, offer, at),
        remove: () => state.agent().removeOffer(lane),
      },
      effects,
    )
  }

  return { build, record, refresh }
}
