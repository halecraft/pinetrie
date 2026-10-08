// host/offers/refresh — what a trigger does to a lane's offer, and an offer
// rebuilt: gather (`gatherRefresh`, `@pinetrie/repo`), decide (`planRefresh`,
// `@pinetrie/rules`), translate (`offerEffects`, `rebuildEffects`) and execute
// (`executeOffer`). The record is written from the repo after each step,
// never read back to decide.

import type { Placed, Rebuild, ThreadId, ThreadName } from "@pinetrie/core"
import { offerBookmark } from "@pinetrie/lanes"
import { readThreadName } from "@pinetrie/reads"
import {
  gatherRefresh,
  offerEffects,
  type RepoOps,
  readOffer,
  rebuildEffects,
  repairOffer,
} from "@pinetrie/repo"
import { offerRecord, planRefresh } from "@pinetrie/rules"
import { executeOffer, type OfferPorts } from "./execute.ts"
import type { OfferDeps } from "./state.ts"

export interface Refresh {
  /** What a trigger does to one lane's offer: "built" when its content changed. */
  refresh(ops: RepoOps, lane: ThreadId): Promise<"built" | "other">
  /** An offer rebuilt (`planStackEnded`, `planRebuild`), then its record. */
  rebuild(ops: RepoOps, lane: ThreadId, rebuild: Rebuild): Promise<void>
  /** The ports an offer step's effects run over, for `lane`'s offer under `name`. */
  ports(ops: RepoOps, lane: ThreadId, name: ThreadName): OfferPorts
}

/** A fresh nonce a build names its commits by (`nonceRevset`). */
const newNonce = () => `pinetrie-offer-${crypto.randomUUID()}`

export function createRefresh(
  deps: Pick<OfferDeps, "basics" | "docs" | "records">,
): Refresh {
  const { basics, docs, records } = deps
  const { session, log } = basics

  function ports(ops: RepoOps, lane: ThreadId, name: ThreadName): OfferPorts {
    const read = (place: Placed) =>
      readOffer(ops.jj, { name, target: place.target })
    return {
      writeBase: records.writeBase,
      run: steps => ops.execute(steps),
      read,
      // A divergent offer is recorded once repaired.
      async record(offer, place) {
        if (offer === null || offer.kind === "divergent") return
        await records.write(
          offerRecord({
            lane,
            name,
            offer,
            place,
            editing: (await ops.shared()).editing,
            now: basics.now(),
          }),
        )
      },
      async repair(changes) {
        await repairOffer(ops, { bookmark: offerBookmark(name), changes })
        log(
          `[host] ${readThreadName(session, lane)}: your edit and the host's crossed; kept yours`,
        )
      },
      remove: () => records.remove(lane),
      async accepted(record) {
        await records.writeAcceptedOffer(record)
      },
    }
  }

  return {
    ports,
    async refresh(ops, lane) {
      // gather
      const now = await gatherRefresh(ops, {
        ...docs.input(lane),
        archived: docs.archived(lane),
      })
      if (now.kind === "none") return "other"
      // A WIP gone without landing: nothing moves, and the page says so.
      if (now.kind === "gone") {
        await records.writeBase(now.base)
        return "other"
      }
      const { name, facts } = now
      // plan
      const effects = offerEffects(planRefresh(facts), {
        lane,
        name,
        entry: docs.tipOf(lane),
        wip: docs.wipLine(lane, name),
        nonce: newNonce(),
      })
      // execute
      return executeOffer(
        ports(ops, lane, name),
        { base: now.base, effects },
        facts.offer,
      )
    },
    async rebuild(ops, lane, rebuild) {
      const effects = rebuildEffects(rebuild, {
        lane,
        entry: docs.tipOf(lane),
        nonce: newNonce(),
      })
      await executeOffer(
        ports(ops, lane, rebuild.name),
        { base: null, effects },
        null,
      )
    },
  }
}
