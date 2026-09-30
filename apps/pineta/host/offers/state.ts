// host/offers/state — what every offer module shares: your repo, its one
// queue, and the reads and writes over the `pineta.offer` records.

import type {
  HaveRecord,
  LaneName,
  OfferRecord,
  ThreadName,
} from "@pineta/core"
import { hasBookmark, hostOps, ONTO_BOOKMARK, offerFacts } from "@pineta/lanes"
import { recordChanged } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readNames, readOffers } from "@pineta/reads"
import type { Basics } from "../basics.ts"
import { createSerial, type Serial } from "../queue.ts"

export interface OfferState {
  readonly root: string
  /** jj on your repo, as the host (`hostOps`): never snapshots your files. */
  readonly ops: ReturnType<typeof hostOps>
  readonly basics: Basics
  readonly agent: () => Agent
  /**
   * The one queue for your repo: every offer operation, take and read, so no
   * two interleave. A read waits here too, since a jj read can write (S57).
   */
  readonly serial: Serial
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take: the base snapshot follows your `@-`. */
  readonly taken: () => void
  offerOf(lane: LaneName): OfferRecord | undefined
  nameOf(lane: LaneName): ThreadName | undefined
  /** An offer's facts now, against what the host last wrote for it. */
  factsOf(offer: OfferRecord, target: string): ReturnType<typeof offerFacts>
  /** Write an offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  writeHave(record: HaveRecord): Promise<void>
  /** Where offers go: `pineta-onto` when you set it, else your `@-`. */
  targetNow(): Promise<string>
}

export function createOfferState(input: {
  readonly root: string
  readonly basics: Basics
  readonly agent: () => Agent
  readonly running: (lane: LaneName) => boolean
  readonly taken: () => void
}): OfferState {
  const { root, basics } = input
  const { doc } = basics
  const ops = hostOps(root)
  const offerOf = (lane: LaneName) => readOffers(doc).get(lane)
  return {
    root,
    ops,
    basics,
    agent: input.agent,
    serial: createSerial(),
    running: input.running,
    taken: input.taken,
    offerOf,
    nameOf: lane => readNames(doc).get(lane),
    factsOf: (offer, target) =>
      offerFacts(ops, {
        changes: offer.host.changes,
        wrote: offer.host.wrote,
        target,
      }),
    async write(record) {
      const next = { kind: "offer" as const, record }
      const stored = offerOf(record.lane)
      if (stored !== undefined && !recordChanged(next, stored)) return
      await input.agent().setWorkRecord(next)
    },
    writeHave: record => input.agent().setWorkRecord({ kind: "have", record }),
    targetNow: async () =>
      (await hasBookmark(ops, ONTO_BOOKMARK)) ? ONTO_BOOKMARK : "@-",
  }
}
