// host/jj/proposed/refresh — what a trigger does to a lane's proposed changes,
// and proposed changes rebuilt: gather (`gatherRefresh`, `@pinetrie/jj`),
// decide (`planRefresh`, `@pinetrie/rules`), translate (`buildEffects`,
// `proposedChangesEffects`, `rebuildEffects`) and execute
// (`executeProposedChanges`). The record is written from the repo after each
// step, never read back to decide. The lane's root is read only after a
// decision to build: every lane is refreshed when accepted work moves, and
// most decide nothing that writes a message.

import type { Placed, Rebuild, ThreadId, ThreadName } from "@pinetrie/core"
import {
  buildEffects,
  gatherRefresh,
  isBuild,
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
  /** Proposed changes rebuilt (`planStackEnded`, `planRebuild`), then its record; `entry` is the lane's tip (`laneTip`). */
  rebuild(
    ops: RepoOps,
    lane: ThreadId,
    rebuild: Rebuild,
    entry: string,
  ): Promise<void>
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
      ops.part("read", () =>
        readProposedChanges(ops.jj, { name, target: place.target }),
      )
    // Each port is a part of the step's slow report.
    return {
      writeBase: base => ops.part("base record", () => records.writeBase(base)),
      run: steps => ops.execute(steps),
      read,
      // Divergent proposed changes are recorded once repaired.
      record: (proposed, place) =>
        ops.part("record", async () => {
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
        }),
      repair: changeIds =>
        ops.part("repair", async () => {
          await repairProposedChanges(ops, {
            bookmark: proposedBookmark(name),
            changeIds,
          })
          log(
            `[host] ${readThreadName(session, lane)}: your edit and the host's crossed; kept yours`,
          )
        }),
      remove: () => ops.part("record", () => records.remove(lane)),
      accepted: record =>
        ops.part("record", () => records.writeAcceptedProposed(record)),
    }
  }

  return {
    ports,
    async refresh(ops, lane) {
      // gather
      const now = await ops.part("gather", () =>
        gatherRefresh(ops, {
          ...docs.input(lane),
          archived: docs.archived(lane),
        }),
      )
      if (now.kind === "none") return "other"
      // A WIP gone without landing: nothing moves, and the page says so.
      if (now.kind === "gone") {
        await ops.part("base record", () => records.writeBase(now.base))
        return "other"
      }
      const { name, facts } = now
      // plan, then what a build's messages need
      const decision = planRefresh(facts)
      const effects = isBuild(decision)
        ? buildEffects(decision, {
            lane,
            name,
            nonce: newNonce(),
            ...(await ops.part("message facts", () =>
              docs.messageFacts(lane, name),
            )),
          })
        : proposedChangesEffects(decision, name)
      // execute
      return executeProposedChanges(
        ports(ops, lane, name),
        { base: now.base, effects },
        facts.proposed,
      )
    },
    async rebuild(ops, lane, rebuild, entry) {
      const effects = rebuildEffects(rebuild, {
        lane,
        entry,
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
