// host/offers/execute — carrying out an offer step's effects
// (`@pinetrie/repo`'s `offerEffects`, `offerAcceptanceEffects`, `rebuildEffects`,
// `describeEffects`) over ports, so a test can check what each makes the
// host write, and in what order.

import type {
  BaseRecord,
  OfferInRepo,
  OfferRecord,
  Placed,
} from "@pinetrie/core"
import type { OfferEffects, RepoStep } from "@pinetrie/repo"

export interface OfferPorts {
  /** The lane's base record, written when it differs from the page's. */
  writeBase(base: BaseRecord | null): Promise<void>
  /** Run jj steps on your repo, in order. */
  run(steps: readonly RepoStep[]): Promise<void>
  /** The offer as your repo holds it now, at the place's target. */
  read(place: Placed): Promise<OfferInRepo | null>
  /** Write the record from `offer`, at `place`. */
  record(offer: OfferInRepo | null, place: Placed): Promise<void>
  /** Repair each divergent change (`repairOffer`). */
  repair(changes: readonly string[]): Promise<void>
  remove(): Promise<void>
  /** Write the record marked accepted, then let the base snapshot follow the bookmark it moved. */
  accepted(record: OfferRecord): Promise<void>
}

/**
 * An offer step's effects, in order: the base record, the steps, then what
 * comes after. `before` is the offer read before planning: with no steps it
 * is still the offer, so the common plan, `none`, reads nothing more.
 */
export async function executeOffer(
  ports: OfferPorts,
  step: { readonly base: BaseRecord | null; readonly effects: OfferEffects },
  before: OfferInRepo | null,
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
      await ports.repair(after.changes)
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
