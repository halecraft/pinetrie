// host/offers/state — what every offer module shares: your repo, its one
// queue, and the gathers: `offerNow` (where a lane's offer sits and starts,
// and the offer itself, read from the repo, ADR-0060), and `refreshNow`,
// which also reads an archived thread's offer and whether the lane's work
// changes any file. The
// `pineta.offer` records are written here, and read only to skip a write
// that changes nothing: the host decides nothing from them.

import type {
  BaseRecord,
  CommitId,
  LaneName,
  OfferInRepo,
  OfferRecord,
  ThreadName,
} from "@pineta/core"
import {
  changesNoFile,
  commitsOf,
  hostOps,
  type LaneBase,
  type LineConfig,
  laneBase,
  laneTipIn,
  readOffer,
  revsetName,
  startOfOffer,
  wipFacts,
} from "@pineta/lanes"
import {
  archivedAt,
  type RefreshFacts,
  recordChanged,
  wipState,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  readArchive,
  readBases,
  readNames,
  readOffers,
  readTreeIndex,
} from "@pineta/reads"
import { readLaneTip } from "@pineta/schema"
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

/** A place where the offer can sit: its base has a commit (not a WIP gone). */
export type Placed = OfferPlace & { readonly target: CommitId }

/** What a refresh plans from: `planRefresh`'s facts, and where they were read. */
export interface RefreshNow {
  readonly name: ThreadName
  /** Null for an archived thread, whose lane's history left your repo. */
  readonly place: Placed | null
  readonly facts: RefreshFacts
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
  nameOf(lane: LaneName): ThreadName | undefined
  /** Write an offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  /** Remove an offer's record, when there is one. */
  remove(lane: LaneName): Promise<void>
  /**
   * The one gather every offer step plans from: where the lane's offer sits
   * and starts (`placeOf`), and the offer as your repo holds it there; null
   * offer with no name yet, no target (a WIP gone), or none in the repo.
   */
  offerNow(lane: LaneName): Promise<{
    readonly place: OfferPlace
    readonly name: ThreadName | undefined
    readonly offer: OfferInRepo | null
  } | null>
  /**
   * Where a lane's offer sits and starts, read from the repo, and the lane's
   * base written as its cache (`pineta.base`); null before the lane has a
   * tip here, or a line commit in its history.
   */
  placeOf(lane: LaneName): Promise<OfferPlace | null>
  /**
   * What a refresh plans from. An archived thread's offer is read against
   * the line: its lane's history is gone, and with it its base, and the
   * thread's trailer leaves a WIP's own commits out of the offer. Null when
   * nothing moves: no name yet, a lane not placed here, or a WIP gone.
   */
  refreshNow(lane: LaneName): Promise<RefreshNow | null>
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
  const nameOf = (lane: LaneName) => readNames(doc).get(lane)
  const commitOf = async (bookmark: string) =>
    (await commitsOf(ops, `present(${revsetName(bookmark)})`))[0] ?? null

  async function writeBase(record: BaseRecord) {
    const next = { kind: "base" as const, record }
    const stored = readBases(doc).get(record.lane)
    if (stored !== undefined && !recordChanged(next, stored)) return
    await input.agent().setWorkRecord(next)
  }

  async function placeOf(lane: LaneName): Promise<OfferPlace | null> {
    // gather
    const tip = await laneTipIn(ops, lane)
    if (tip === null) return null
    const base = await laneBase(ops, tip, line)
    if (base === null) return null
    const state =
      base.base.kind === "wip"
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
    nameOf,
    async write(record) {
      const next = { kind: "offer" as const, record }
      const stored = readOffers(doc).get(record.lane)
      if (stored !== undefined && !recordChanged(next, stored)) return
      await input.agent().setWorkRecord(next)
    },
    async remove(lane) {
      if (readOffers(doc).has(lane)) await input.agent().removeOffer(lane)
    },
    placeOf,
    async refreshNow(lane) {
      const name = nameOf(lane)
      if (name === undefined) return null
      const archived =
        archivedAt(
          readTreeIndex(doc),
          readArchive(doc),
          readLaneTip(doc, lane),
        ) !== null
      if (archived) {
        const target = `present(${revsetName(line.onto)})`
        const offer = await readOffer(ops, { name, target })
        return { name, place: null, facts: { archived, offer } }
      }
      const place = await placeOf(lane)
      if (place === null || place.target === null) return null
      const { tip, start, target } = place
      return {
        name,
        place: { ...place, target },
        facts: {
          archived,
          tip,
          start,
          empty: await changesNoFile(ops, { start, tip }),
          offer: await readOffer(ops, { name, target }),
        },
      }
    },
    async offerNow(lane) {
      const place = await placeOf(lane)
      if (place === null) return null
      const name = nameOf(lane)
      const offer =
        name === undefined || place.target === null
          ? null
          : await readOffer(ops, { name, target: place.target })
      return { place, name, offer }
    },
  }
}
