// host/offers/state — what the offer modules share, built once by
// `startOffers`: what the documents say of a lane (`OfferDocs`), the
// records the host writes (`OfferRecords`), and the owner of your repo
// (`@pineta/repo`, ADR-0065). Every read of your repo is `@pineta/repo`'s
// (`gatherOffer`, `gatherRefresh`, …), and every decision `@pineta/rules`': the
// documents are read here only for what your repo cannot say, and a record
// only to skip a write that changes nothing (ADR-0060).

import {
  type BaseRecord,
  firstPromptOf,
  type LaneName,
  type OfferRecord,
  projectTranscript,
  type ThreadName,
  type ValueWrite,
  wipDescription,
} from "@pineta/core"
import type { LineConfig } from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import {
  readArchive,
  readBases,
  readNames,
  readOffers,
  readRevisions,
  readRoots,
  readTreeIndex,
} from "@pineta/reads"
import type { OfferInput, RepoOwner } from "@pineta/repo"
import {
  archivedIn,
  BASE,
  deleteRecord,
  OFFER,
  setIfChanged,
  setRecord,
} from "@pineta/rules"
import { readLaneTip } from "@pineta/schema"
import type { Basics } from "../basics.ts"

/** What the documents say of a lane, for what your repo cannot say. */
export interface OfferDocs {
  nameOf(lane: LaneName): ThreadName | undefined
  /** Read from the archive record, never from the lane's tip being missing: a tip missing for one import (S78) must not withdraw a live offer. */
  archived(lane: LaneName): boolean
  /** A gather's input: the lane, its name, the line's names, and the last catch-up read, a memo `readCatchUp` keeps at the same tip and base commit. */
  input(lane: LaneName): OfferInput
  /** The lane's tip entry, for `Pineta-Entry`; "" for none. */
  tipOf(lane: LaneName): string
  /**
   * An offer's line until an agent describes it: the thread's name and its
   * own first message, the first prompt its lane ran (ADR-0039).
   */
  wipLine(lane: LaneName, name: ThreadName): string
}

/** The records the host writes from your repo, the page's cache (ADR-0060). */
export interface OfferRecords {
  /** An offer's record, when it changed. */
  write(record: OfferRecord): Promise<void>
  /** An integrated offer's record, written whatever is there. */
  writeIntegratedOffer(record: OfferRecord): Promise<void>
  /** Remove an offer's record, when there is one. */
  remove(lane: LaneName): Promise<void>
  /** The lane's base record as the repo says it, when it differs from the page's; none for null. */
  writeBase(next: BaseRecord | null): Promise<void>
  writeValues(writes: readonly ValueWrite[]): Promise<void>
}

/** Everything an offer module may use; each names the `Pick` it needs. */
export interface OfferDeps {
  /** The one writer of your repo: commands, refreshes as upkeep, pinned reads. */
  readonly owner: RepoOwner
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  readonly basics: Basics
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After an offer integration: the base snapshot follows the bookmark it moved. */
  readonly bookmarkMoved: () => void
  readonly docs: OfferDocs
  readonly records: OfferRecords
}

export function createOfferDeps(input: {
  readonly owner: RepoOwner
  readonly line: LineConfig
  readonly basics: Basics
  readonly agent: () => Agent
  readonly running: (lane: LaneName) => boolean
  readonly bookmarkMoved: () => void
}): OfferDeps {
  const { basics, line } = input
  const { session: doc, docs } = basics
  const writeValues = (writes: readonly ValueWrite[]) =>
    writes.length === 0 ? Promise.resolve() : input.agent().writeValues(writes)
  const nameOf = (lane: LaneName) => readNames(doc).get(lane)
  const offerDocs: OfferDocs = {
    nameOf,
    archived(lane) {
      const root = docs.rootOfLane(lane)
      return (
        archivedIn(
          root === null ? [] : [root],
          readRoots(doc),
          readArchive(doc),
        ) !== null
      )
    },
    input: lane => ({
      lane,
      name: nameOf(lane),
      line,
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
    writeIntegratedOffer: record => writeValues([setRecord(OFFER, record)]),
    remove: lane =>
      readOffers(doc).has(lane)
        ? writeValues([deleteRecord(OFFER, lane)])
        : Promise.resolve(),
    writeBase: next =>
      next === null
        ? Promise.resolve()
        : writeValues(setIfChanged(BASE, next, readBases(doc).get(next.lane))),
  }
  return {
    owner: input.owner,
    line,
    basics,
    agent: input.agent,
    running: input.running,
    bookmarkMoved: input.bookmarkMoved,
    docs: offerDocs,
    records,
  }
}
