// host/offers/state — what every offer module shares: your repo, its one
// queue, the reads and writes over the `pineta.offer` records, and where a
// lane's offer sits and starts, read from the repo (ADR-0060).

import type {
  BaseRecord,
  CommitId,
  LaneName,
  OfferRecord,
  ThreadName,
} from "@pineta/core"
import {
  commitsOf,
  hostOps,
  type LaneBase,
  type LineConfig,
  laneBase,
  laneTipIn,
  offerFacts,
  revsetName,
  startOfOffer,
  wipFacts,
} from "@pineta/lanes"
import { recordChanged, wipState } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readBases, readNames, readOffers } from "@pineta/reads"
import type { Basics } from "../basics.ts"
import { createSerial, type Serial } from "../queue.ts"

/** Where a lane's offer sits and starts, read from your repo now (ADR-0060). */
export interface OfferPlace {
  /** The lane's tip in your repo. */
  readonly tip: CommitId
  readonly base: LaneBase
  /** A WIP base's state; "ok" for the line. */
  readonly state: BaseRecord["state"]
  /**
   * Where the offer sits: the line's commit, or the WIP bookmark's; null for
   * a WIP gone without landing, where nothing moves.
   */
  readonly target: CommitId | null
  /** Where it starts (`startOfOffer`). */
  readonly start: readonly CommitId[]
}

export interface OfferState {
  readonly root: string
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /** Whether this host takes `line` commands: it admits no one else. */
  readonly lineCommands: boolean
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
  /** After a take or a land: the base snapshot follows the line. */
  readonly taken: () => void
  offerOf(lane: LaneName): OfferRecord | undefined
  nameOf(lane: LaneName): ThreadName | undefined
  /** An offer's facts now, against what the host last wrote for it. */
  factsOf(offer: OfferRecord, target: string): ReturnType<typeof offerFacts>
  /** Write an offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  /**
   * Where a lane's offer sits and starts, read from the repo, and the lane's
   * base written as its cache (`pineta.base`); null before the lane has a
   * tip here, or a line commit in its history.
   */
  placeOf(lane: LaneName): Promise<OfferPlace | null>
}

export function createOfferState(input: {
  readonly root: string
  readonly line: LineConfig
  readonly lineCommands: boolean
  readonly basics: Basics
  readonly agent: () => Agent
  readonly running: (lane: LaneName) => boolean
  readonly taken: () => void
}): OfferState {
  const { root, basics, line } = input
  const { doc } = basics
  const ops = hostOps(root)
  const offerOf = (lane: LaneName) => readOffers(doc).get(lane)
  const commitOf = async (bookmark: string) =>
    (await commitsOf(ops, `present(${revsetName(bookmark)})`))[0] ?? null

  async function writeBase(record: BaseRecord) {
    const next = { kind: "base" as const, record }
    const stored = readBases(doc).get(record.lane)
    if (stored !== undefined && !recordChanged(next, stored)) return
    await input.agent().setWorkRecord(next)
  }

  return {
    root,
    line,
    lineCommands: input.lineCommands,
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
    async placeOf(lane) {
      // gather
      const tip = await laneTipIn(ops, lane)
      if (tip === null) return null
      const base = await laneBase(ops, tip, line)
      if (base === null) return null
      const state =
        base.base.kind === "wip" && base.source !== null
          ? wipState(await wipFacts(ops, line, base.base.bookmark, base.source))
          : "ok"
      const target =
        base.base.kind === "wip" && state === "ok"
          ? await commitOf(base.base.bookmark)
          : state === "gone"
            ? null
            : await commitOf(line.onto)
      const start = await startOfOffer(ops, { tip, base, line })
      await writeBase({ lane, base: base.base, start: base.start, state })
      return { tip, base, state, target, start }
    },
  }
}
