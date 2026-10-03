// host/offers/state — what every offer module shares: the owner of your repo
// (`@pineta/repo`, ADR-0065), and the gathers: `offerNow` (where a lane's
// offer sits and starts, and the offer itself, read from the repo, ADR-0060),
// and `refreshNow`, which also reads an archived thread's offer and whether
// the lane's work changes any file. Each gather reads through the jj it is
// given, a step's or a pinned read's, and writes nothing: what it found that
// the page caches (`pineta.base`) is written by the plan that uses it. The
// `pineta.offer` records are written here, and read only to skip a write
// that changes nothing: the host decides nothing from them.

import type {
  BaseRecord,
  CommitId,
  LaneBase,
  LaneName,
  OfferInRepo,
  OfferRecord,
  ThreadName,
  ValueWrite,
} from "@pineta/core"
import {
  commitsOf,
  type LineConfig,
  laneBase,
  type Runner,
  revsetName,
} from "@pineta/lanes"
import {
  archivedIn,
  deleteRecord,
  OFFER,
  type RefreshFacts,
  setIfChanged,
  wipState,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  readArchive,
  readBases,
  readNames,
  readOffers,
  readRoots,
} from "@pineta/reads"
import {
  changesNoFile,
  gatherLane,
  laneTipIn,
  type RepoOps,
  type RepoOwner,
  readOffer,
  startOfOffer,
  wipFacts,
} from "@pineta/repo"
import type { Basics } from "../basics.ts"
import type { BaseNow } from "./plan.ts"

/** What a gather reads through: a step's jj, or a pinned read's. */
export interface Reader {
  readonly jj: Runner
}

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

/**
 * What a refresh plans from: `planRefresh`'s facts, where they were read, and
 * the lane's base; or, for a WIP gone without landing, only its base, for the
 * page to say so.
 */
export type RefreshNow =
  | {
      readonly kind: "plan"
      readonly name: ThreadName
      /** Null for an archived thread, whose lane's history left your repo. */
      readonly place: Placed | null
      /** Null for an archived thread. */
      readonly base: BaseNow | null
      readonly facts: RefreshFacts
    }
  | { readonly kind: "gone"; readonly base: BaseNow }

export interface OfferState {
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /** Whether this host takes `line` commands: it admits no one else. */
  readonly lineCommands: boolean
  /** The one writer of your repo: commands, refreshes as upkeep, pinned reads. */
  readonly owner: RepoOwner
  readonly basics: Basics
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take or a land: the base snapshot follows the line. */
  readonly taken: () => void
  /** Lanes with a model request out for their description: one at a time. */
  readonly describing: Set<LaneName>
  nameOf(lane: LaneName): ThreadName | undefined
  /** Write records to the documents. */
  writeValues(writes: readonly ValueWrite[]): Promise<void>
  /** Write an offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  /** Remove an offer's record, when there is one. */
  remove(lane: LaneName): Promise<void>
  /** The lane's base record as `place` says it, and as the page has it. */
  baseOf(lane: LaneName, place: OfferPlace): BaseNow
  /**
   * The one gather every offer step plans from: where the lane's offer sits
   * and starts (`placeOf`), and the offer as your repo holds it there; null
   * offer with no name yet, no target (a WIP gone), or none in the repo.
   */
  offerNow(
    ops: Reader,
    lane: LaneName,
  ): Promise<{
    readonly place: OfferPlace
    readonly name: ThreadName | undefined
    readonly offer: OfferInRepo | null
  } | null>
  /**
   * Where a lane's offer sits and starts, read from the repo; null before the
   * lane has a tip here, or a line commit in its history. Writes nothing.
   */
  placeOf(ops: Reader, lane: LaneName): Promise<OfferPlace | null>
  /**
   * What a refresh plans from. An archived thread's offer is read against
   * the line: its lane's history is gone, and with it its base, and the
   * thread's trailer leaves a WIP's own commits out of the offer. Null when
   * nothing moves: no name yet, a lane not placed here, or a WIP gone.
   */
  refreshNow(ops: RepoOps, lane: LaneName): Promise<RefreshNow | null>
}

export function createOfferState(input: {
  readonly owner: RepoOwner
  readonly line: LineConfig
  readonly lineCommands: boolean
  readonly basics: Basics
  readonly agent: () => Agent
  readonly running: (lane: LaneName) => boolean
  readonly taken: () => void
}): OfferState {
  const { basics, line } = input
  const { session: doc, docs } = basics
  const nameOf = (lane: LaneName) => readNames(doc).get(lane)
  const commitOf = async ({ jj }: Reader, bookmark: string) =>
    (await commitsOf(jj, `present(${revsetName(bookmark)})`))[0] ?? null
  const writeValues = (writes: readonly ValueWrite[]) =>
    input.agent().writeValues(writes)

  async function placeOf(
    ops: Reader,
    lane: LaneName,
  ): Promise<OfferPlace | null> {
    const { jj } = ops
    const tip = await laneTipIn(jj, lane)
    if (tip === null) return null
    const base = await laneBase(jj, tip, line)
    if (base === null) return null
    const state = wipState(await wipFacts(jj, line, base))
    const target =
      base.base.kind === "wip" && state === "ok"
        ? await commitOf(ops, base.base.bookmark)
        : state === "gone"
          ? null
          : await commitOf(ops, line.onto)
    const start = await startOfOffer(jj, { tip, base, line })
    return { tip, base, state, target, start }
  }

  function baseOf(lane: LaneName, place: OfferPlace): BaseNow {
    const next: BaseRecord = {
      lane,
      base: place.base.base,
      start: place.base.start,
      state: place.state,
    }
    return { next, stored: readBases(doc).get(lane) }
  }

  return {
    line,
    lineCommands: input.lineCommands,
    owner: input.owner,
    basics,
    agent: input.agent,
    running: input.running,
    taken: input.taken,
    describing: new Set(),
    nameOf,
    writeValues,
    async write(record) {
      await writeValues(
        setIfChanged(OFFER, record, readOffers(doc).get(record.lane)),
      )
    },
    async remove(lane) {
      if (readOffers(doc).has(lane))
        await writeValues([deleteRecord(OFFER, lane)])
    },
    baseOf,
    placeOf,
    async refreshNow(ops, lane) {
      const name = nameOf(lane)
      if (name === undefined) return null
      const root = docs.rootOfLane(lane)
      const archived =
        archivedIn(
          root === null ? [] : [root],
          readRoots(doc),
          readArchive(doc),
        ) !== null
      if (archived) {
        const target = `present(${revsetName(line.onto)})`
        const offer = await readOffer(ops.jj, { name, target })
        return {
          kind: "plan",
          name,
          place: null,
          base: null,
          facts: { archived, offer },
        }
      }
      // A lane on the line: one read, and the shared facts (ADR-0065).
      const shared = await ops.shared()
      const gathered = await gatherLane(ops.jj, { lane, name, line, shared })
      if (gathered === "none") return null
      if (gathered !== "wip") {
        const { tip, base, target, start, offer, empty } = gathered
        const placed: Placed = { tip, base, state: "ok", target, start }
        return {
          kind: "plan",
          name,
          base: baseOf(lane, placed),
          place: placed,
          facts: { archived, tip, start, empty, offer },
        }
      }
      // A lane on a WIP: the separate reads.
      const place = await placeOf(ops, lane)
      if (place === null) return null
      const base = baseOf(lane, place)
      if (place.target === null) return { kind: "gone", base }
      const { tip, start, target } = place
      return {
        kind: "plan",
        name,
        base,
        place: { ...place, target },
        facts: {
          archived,
          tip,
          start,
          empty: await changesNoFile(ops.jj, { start, tip }),
          offer: await readOffer(ops.jj, { name, target }),
        },
      }
    },
    async offerNow(ops, lane) {
      const place = await placeOf(ops, lane)
      if (place === null) return null
      const name = nameOf(lane)
      const offer =
        name === undefined || place.target === null
          ? null
          : await readOffer(ops.jj, { name, target: place.target })
      return { place, name, offer }
    },
  }
}
