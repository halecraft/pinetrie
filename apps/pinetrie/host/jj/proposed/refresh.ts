// host/jj/proposed/refresh — what a trigger does to a lane's proposed changes,
// and proposed changes rebuilt: gather (`gatherRefresh`, `@pinetrie/jj`),
// decide (`planRefresh`, `@pinetrie/rules`), translate
// (`proposedChangesEffects`, `rebuildEffects`) and execute
// (`executeProposedChanges`). The record is written from the repo after each
// step, never read back to decide.

import type { Placed, Rebuild, ThreadId, ThreadName } from "@pinetrie/core"
import {
  gatherRefresh,
  proposedBookmark,
  proposedChangesEffects,
  type RepoOps,
  readProposedChanges,
  rebuildEffects,
  repairProposedChanges,
} from "@pinetrie/jj"
import { readThreadName } from "@pinetrie/reads"
import { planRefresh, proposedChangesRecord } from "@pinetrie/rules"
import { executeProposedChanges, type ProposedChangesPorts } from "./execute.ts"
import type { ProposedChangesDeps } from "./state.ts"

export interface Refresh {
  /** What a trigger does to one lane's proposed changes: "built" when its content changed. */
  refresh(ops: RepoOps, lane: ThreadId): Promise<"built" | "other">
  /** Proposed changes rebuilt (`planStackEnded`, `planRebuild`), then its record. */
  rebuild(ops: RepoOps, lane: ThreadId, rebuild: Rebuild): Promise<void>
  /** The ports the effects of a step on proposed changes run over, for `lane`'s proposed changes under `name`. */
  ports(ops: RepoOps, lane: ThreadId, name: ThreadName): ProposedChangesPorts
}

/** A fresh nonce a build names its commits by (`nonceRevset`). */
const newNonce = () => `pinetrie-proposed-${crypto.randomUUID()}`

export function createRefresh(
  deps: Pick<ProposedChangesDeps, "basics" | "docs" | "records">,
): Refresh {
  const { basics, docs, records } = deps
  const { session, log } = basics

  function ports(
    ops: RepoOps,
    lane: ThreadId,
    name: ThreadName,
  ): ProposedChangesPorts {
    const read = (place: Placed) =>
      readProposedChanges(ops.jj, { name, target: place.target })
    return {
      writeBase: records.writeBase,
      run: steps => ops.execute(steps),
      read,
      // Divergent proposed changes are recorded once repaired.
      async record(proposed, place) {
        if (proposed === null || proposed.kind === "divergent") return
        await records.write(
          proposedChangesRecord({
            lane,
            name,
            proposed,
            place,
            editing: (await ops.shared()).editing,
            now: basics.now(),
          }),
        )
      },
      async repair(changeIds) {
        await repairProposedChanges(ops, {
          bookmark: proposedBookmark(name),
          changeIds,
        })
        log(
          `[host] ${readThreadName(session, lane)}: your edit and the host's crossed; kept yours`,
        )
      },
      remove: () => records.remove(lane),
      async accepted(record) {
        await records.writeAcceptedProposed(record)
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
      const effects = proposedChangesEffects(planRefresh(facts), {
        lane,
        name,
        entry: docs.tipOf(lane),
        wip: docs.wipLine(lane, name),
        nonce: newNonce(),
      })
      // execute
      return executeProposedChanges(
        ports(ops, lane, name),
        { base: now.base, effects },
        facts.proposed,
      )
    },
    async rebuild(ops, lane, rebuild) {
      const effects = rebuildEffects(rebuild, {
        lane,
        entry: docs.tipOf(lane),
        nonce: newNonce(),
      })
      await executeProposedChanges(
        ports(ops, lane, rebuild.name),
        { base: null, effects },
        null,
      )
    },
  }
}
