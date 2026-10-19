// host/jj/proposed/execute — carrying out the effects of a step on proposed
// changes (`@pinetrie/jj`'s `proposedChangesEffects`, `acceptanceEffects`,
// `rebuildEffects`, `describeEffects`) over ports, so a test can check what
// each makes the host write, and in what order.

import type {
  JjBaseRecord,
  Placed,
  ProposedChangesInRepo,
  ProposedChangesRecord,
} from "@pinetrie/core"
import type { ProposedChangesEffects, RepoStep } from "@pinetrie/jj"

export interface ProposedChangesPorts {
  /** The lane's base record, written when it differs from the page's. */
  writeBase(base: JjBaseRecord | null): Promise<void>
  /** Run jj steps on your repo, in order. */
  run(steps: readonly RepoStep[]): Promise<void>
  /** The proposed changes as your repo holds it now, at the place's target. */
  read(place: Placed): Promise<ProposedChangesInRepo | null>
  /** Write the record from `proposed`, at `place`. */
  record(proposed: ProposedChangesInRepo | null, place: Placed): Promise<void>
  /** Repair each divergent change (`repairProposedChanges`). */
  repair(changeIds: readonly string[]): Promise<void>
  remove(): Promise<void>
  /** Write the record marked accepted, then let the base snapshot follow the bookmark it moved. */
  accepted(record: ProposedChangesRecord): Promise<void>
}

/**
 * The effects of a step on proposed changes, in order: the base record, the
 * steps, then what comes after. `before` is the proposed changes read before
 * planning: with no steps it is still the proposed changes, so the common plan,
 * `none`, reads nothing more.
 */
export async function executeProposedChanges(
  ports: ProposedChangesPorts,
  step: {
    readonly base: JjBaseRecord | null
    readonly effects: ProposedChangesEffects
  },
  before: ProposedChangesInRepo | null,
): Promise<"built" | "other"> {
  const { effects } = step
  await ports.writeBase(step.base)
  await ports.run(effects.steps)
  const { after } = effects
  switch (after.kind) {
    case "nothing":
      break
    case "record":
      await ports.record(
        effects.steps.length === 0 ? before : await ports.read(after.place),
        after.place,
      )
      break
    case "repair":
      await ports.repair(after.changeIds)
      await ports.record(await ports.read(after.place), after.place)
      break
    case "remove":
      await ports.remove()
      break
    case "accepted":
      await ports.accepted(after.record)
      break
  }
  return effects.built ? "built" : "other"
}
