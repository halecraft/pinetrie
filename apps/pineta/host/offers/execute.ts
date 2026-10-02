// host/offers/execute — carrying out an offer's plans (`plan.ts`) over
// ports, so a test can check what each plan makes the host write.

import type { OfferInRepo, OfferRecord } from "@pineta/core"
import type { LaneStep, OfferSource } from "@pineta/lanes"
import type { OfferEffects, planTake } from "./plan.ts"

export interface OfferPorts {
  /** Run jj steps on your repo, in order. */
  run(steps: readonly LaneStep[]): Promise<void>
  build(sources: readonly OfferSource[]): Promise<void>
  /** The offer as your repo holds it now. */
  read(): Promise<OfferInRepo | null>
  /** Write the record from `offer`. */
  record(offer: OfferInRepo | null): Promise<void>
  repair(changes: readonly string[]): Promise<void>
  remove(): Promise<void>
}

/**
 * A refresh's effects: its steps, then what it writes. `before` is the offer
 * read before planning: with no steps it is still the offer, so the common
 * plan, `none`, reads nothing more.
 */
export async function executeOffer(
  ports: OfferPorts,
  effects: OfferEffects,
  before: OfferInRepo | null,
): Promise<"built" | "other"> {
  await ports.run(effects.steps)
  const { after } = effects
  switch (after.kind) {
    case "nothing":
      break
    case "build":
      await ports.build(after.sources)
      break
    case "record":
      await ports.record(
        effects.steps.length === 0 ? before : await ports.read(),
      )
      break
    case "repair":
      await ports.repair(after.changes)
      break
    case "remove":
      await ports.remove()
      break
  }
  return effects.built ? "built" : "other"
}

/** A take, in order: its steps, the record taken, then the base snapshot follows the line. */
export async function executeTake(
  ports: {
    readonly run: OfferPorts["run"]
    writeTaken(offer: OfferRecord): Promise<void>
    taken(): void
  },
  planned: Extract<ReturnType<typeof planTake>, { kind: "take" }>,
): Promise<void> {
  await ports.run(planned.steps)
  await ports.writeTaken(planned.taken)
  ports.taken()
}
