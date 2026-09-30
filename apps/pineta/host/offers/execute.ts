// host/offers/execute — carrying out an offer's plans (`plan.ts`) over
// ports, so a test can check what each plan makes the host write.

import type { CommitId, HaveRecord, OfferRecord } from "@pineta/core"
import type { LaneStep, OfferSource } from "@pineta/lanes"
import type { OfferAt, OfferEffects, planTake } from "./plan.ts"

export interface OfferPorts {
  /** Run jj steps on your repo, in order. */
  run(steps: readonly LaneStep[]): Promise<void>
  build(sources: readonly OfferSource[]): Promise<void>
  /** The offer's commits now, after steps rewrote it. */
  reread(offer: OfferRecord): Promise<readonly CommitId[]>
  /** Write the record; `known`: with the facts read before planning. */
  record(at: OfferAt, known: boolean): Promise<void>
  repair(offer: OfferRecord, at: OfferAt): Promise<void>
  remove(): Promise<void>
}

/** A refresh's effects: its steps, then what it writes. */
export async function executeOffer(
  ports: OfferPorts,
  effects: OfferEffects,
): Promise<"built" | "other"> {
  await ports.run(effects.steps)
  const { after } = effects
  switch (after.kind) {
    case "nothing":
      break
    case "build":
      await ports.build(after.sources)
      break
    case "record": {
      const commits =
        after.reread === null
          ? after.at.commits
          : await ports.reread(after.reread)
      await ports.record({ ...after.at, commits }, after.known)
      break
    }
    case "repair":
      await ports.repair(after.offer, after.at)
      break
    case "remove":
      await ports.remove()
      break
  }
  return effects.built ? "built" : "other"
}

/** A take, in order: its steps, the have it delivers, the record taken, then the base snapshot follows. */
export async function executeTake(
  ports: {
    readonly run: OfferPorts["run"]
    writeHave(have: HaveRecord): Promise<void>
    writeTaken(offer: OfferRecord): Promise<void>
    taken(): void
  },
  planned: NonNullable<ReturnType<typeof planTake>>,
): Promise<void> {
  await ports.run(planned.steps)
  await ports.writeHave(planned.have)
  await ports.writeTaken(planned.taken)
  ports.taken()
}
