// host/offers/state — what the offer modules share, built once by
// `startOffers`: what the documents say of a lane (`OfferDocs`), the
// records the host writes (`OfferRecords`), and the owner of your repo
// (`@pinetrie/repo`, ADR-0065). Every read of your repo is `@pinetrie/repo`'s
// (`gatherOffer`, `gatherRefresh`, …), and every decision `@pinetrie/rules`': the
// documents are read here only for what your repo cannot say, and a record
// only to skip a write that changes nothing (ADR-0104).

import {
  type BaseRecord,
  firstPromptOf,
  type OfferRecord,
  projectTranscript,
  type ThreadId,
  type ThreadName,
  type ValueWrite,
  wipDescription,
} from "@pinetrie/core"
import type { RepoConfig } from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import {
  readArchived,
  readBases,
  readNames,
  readOffers,
  readRevisions,
  readTreeIndex,
} from "@pinetrie/reads"
import type { OfferInput, RepoOwner } from "@pinetrie/repo"
import {
  archivedIn,
  BASE,
  deleteRecord,
  OFFER,
  setIfChanged,
  setRecord,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"

/** What the documents say of a lane, for what your repo cannot say. */
export interface OfferDocs {
  nameOf(lane: ThreadId): ThreadName | undefined
  /** Read from the archive record, never from the lane's tip being missing: a tip missing for one import (S78) must not withdraw a live offer. */
  archived(lane: ThreadId): boolean
  /** A gather's input: the lane, its name, accepted work's names, and the last catch-up read, a memo `readCatchUp` keeps at the same tip and base commit. */
  input(lane: ThreadId): OfferInput
  /** The lane's tip entry, for `Pinetrie-Entry`; "" for none. */
  tipOf(lane: ThreadId): string
  /**
   * An offer's line until an agent describes it: the thread's name and its
   * own first message, the first prompt its lane ran (ADR-0039).
   */
  wipLine(lane: ThreadId, name: ThreadName): string
}

/** The records the host writes from your repo, the page's cache (ADR-0104). */
export interface OfferRecords {
  /** An offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  /** An accepted offer's record, written whatever is there. */
  writeAcceptedOffer(record: OfferRecord): Promise<void>
  /** Remove an offer's record, when there is one. */
  remove(lane: ThreadId): Promise<void>
  /** The lane's base record as the repo says it, when it differs from the page's; none for null. */
  writeBase(next: BaseRecord | null): Promise<void>
  writeValues(writes: readonly ValueWrite[]): Promise<void>
}

/** Everything an offer module may use; each names the `Pick` it needs. */
export interface OfferDeps {
  /** The one writer of your repo: commands, refreshes as upkeep, pinned reads. */
  readonly owner: RepoOwner
  /** Accepted work's names (ADR-0104). */
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  /** What a description asks of the model. */
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: ThreadId) => boolean
  readonly docs: OfferDocs
  readonly records: OfferRecords
}

export function createOfferDeps(input: {
  readonly owner: RepoOwner
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  readonly running: (lane: ThreadId) => boolean
  /** A lane's base record changed. */
  readonly baseChanged: (lane: ThreadId) => void
}): OfferDeps {
  const { basics, repoConfig } = input
  const { session: doc, docs } = basics
  const writeValues = (writes: readonly ValueWrite[]) =>
    writes.length === 0 ? Promise.resolve() : input.records.writeValues(writes)
  const nameOf = (lane: ThreadId) => readNames(doc).get(lane)
  const offerDocs: OfferDocs = {
    nameOf,
    archived(lane) {
      const root = docs.rootOfLane(lane)
      return archivedIn(root === null ? [] : [root], readArchived(doc)) !== null
    },
    input: lane => ({
      lane,
      name: nameOf(lane),
      repoConfig,
      known: readBases(doc).get(lane)?.catchUp ?? null,
    }),
    tipOf(lane) {
      const root = docs.docOfLane(lane)
      return (root === null ? null : readLaneTip(root, lane)) ?? ""
    },
    wipLine(lane, name) {
      const root = docs.docOfLane(lane)
      if (root === null) return wipDescription(name, "")
      const index = readTreeIndex(root)
      const tip = readLaneTip(root, lane)
      const first = firstPromptOf(index, readRevisions(root), lane, tip)
      const text = projectTranscript(index, tip).find(m => m.id === first)?.text
      return wipDescription(name, text ?? "")
    },
  }
  const records: OfferRecords = {
    writeValues,
    write: record =>
      writeValues(
        setIfChanged(OFFER, record, readOffers(doc).get(record.lane)),
      ),
    writeAcceptedOffer: record => writeValues([setRecord(OFFER, record)]),
    remove: lane =>
      readOffers(doc).has(lane)
        ? writeValues([deleteRecord(OFFER, lane)])
        : Promise.resolve(),
    async writeBase(next) {
      if (next === null) return
      const writes = setIfChanged(BASE, next, readBases(doc).get(next.lane))
      if (writes.length === 0) return
      await writeValues(writes)
      // Announced, so a running thread whose base now has news is told (ADR-0080).
      input.baseChanged(next.lane)
    },
  }
  return {
    owner: input.owner,
    repoConfig,
    basics,
    piSetup: input.piSetup,
    running: input.running,
    docs: offerDocs,
    records,
  }
}
