// host/jj/proposed/state — what the proposed changes modules share, built once
// by `startProposedChanges`: what the documents say of a lane
// (`ProposedChangesDocs`), the records the host writes
// (`ProposedChangesRecords`), and the owner of your repo (`@pinetrie/jj`).
// Every read of your repo is `@pinetrie/jj`'s (`gatherProposedChanges`,
// `gatherRefresh`, …), and every decision `@pinetrie/rules`': the documents are
// read here only for what your repo cannot say, and a record only to skip a
// write that changes nothing.

import {
  type BaseRecord,
  type CatchUpRead,
  firstPromptOf,
  type JjBaseRecord,
  type ProposedChangesRecord,
  projectTranscript,
  type RepoConfig,
  type ThreadId,
  type ThreadName,
  type ValueWrite,
  wipDescription,
} from "@pinetrie/core"
import type { ProposedChangesInput, RepoOwner } from "@pinetrie/jj"
import type { PiSetup } from "@pinetrie/pi"
import {
  readArchived,
  readBases,
  readNames,
  readProposedByLane,
  readRevisions,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  archivedIn,
  BASE,
  deleteRecord,
  PROPOSED_CHANGES,
  setIfChanged,
  setRecord,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "../../basics.ts"
import { canvasesNow } from "../../canvases.ts"
import type { Records } from "../../records.ts"

/** What the documents say of a lane, for what your repo cannot say. */
export interface ProposedChangesDocs {
  nameOf(lane: ThreadId): ThreadName | undefined
  /** Read from the archive record, never from the lane's tip being missing: a tip missing for one import must not withdraw live proposed changes. */
  archived(lane: ThreadId): boolean
  /** A gather's input: the lane, its name, accepted work's names, and the last catch-up read, a memo `readCatchUp` keeps at the same tip and base commit. */
  input(lane: ThreadId): ProposedChangesInput
  /** The lane's tip entry, for `Pinetrie-Entry`; "" for none. */
  tipOf(lane: ThreadId): string
  /**
   * Proposed changes' line until an agent describes it: the thread's name and
   * its own first message, the first prompt its lane ran.
   */
  wipLine(lane: ThreadId, name: ThreadName): string
}

/** The records the host writes from your repo, the page's cache. */
export interface ProposedChangesRecords {
  /** Proposed changes' record, when it changed. */
  write(record: ProposedChangesRecord): Promise<void>
  /** Accepted proposed changes' record, written whatever is there. */
  writeAcceptedProposed(record: ProposedChangesRecord): Promise<void>
  /** Remove proposed changes' record, when there is one. */
  remove(lane: ThreadId): Promise<void>
  /** The lane's base record as the repo says it, when it differs from the page's; none for null. */
  writeBase(next: JjBaseRecord | null): Promise<void>
  writeValues(writes: readonly ValueWrite[]): Promise<void>
}

/** Everything proposed changes module may use; each names the `Pick` it needs. */
export interface ProposedChangesDeps {
  /** The one writer of your repo: commands, refreshes as upkeep, pinned reads. */
  readonly owner: RepoOwner
  /** Accepted work's names. */
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  /** What a description asks of the model. */
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  /** Whether a lane is running now: proposed changes are described once it stops. */
  readonly running: (lane: ThreadId) => boolean
  readonly docs: ProposedChangesDocs
  readonly records: ProposedChangesRecords
}

export function createProposedChangesDeps(input: {
  readonly owner: RepoOwner
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  readonly running: (lane: ThreadId) => boolean
  /** A lane's base record changed. */
  readonly baseChanged: (lane: ThreadId) => void
}): ProposedChangesDeps {
  const { basics, repoConfig } = input
  const { session: doc, docs } = basics
  const writeValues = (writes: readonly ValueWrite[]) =>
    writes.length === 0 ? Promise.resolve() : input.records.writeValues(writes)
  const nameOf = (lane: ThreadId) => readNames(doc).get(lane)
  const proposedDocs: ProposedChangesDocs = {
    nameOf,
    archived(lane) {
      const canvas = canvasesNow({
        places: basics.places,
        session: doc,
      }).canvasOfThread.get(lane)
      return (
        archivedIn(
          canvas === undefined ? [] : [canvas],
          readArchived(doc, basics.places),
        ) !== null
      )
    },
    input: lane => ({
      lane,
      name: nameOf(lane),
      repoConfig,
      known: jjCatchUp(readBases(doc).get(lane)),
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
  const records: ProposedChangesRecords = {
    writeValues,
    write: record =>
      writeValues(
        setIfChanged(
          PROPOSED_CHANGES,
          record,
          readProposedByLane(doc).get(record.lane),
        ),
      ),
    writeAcceptedProposed: record =>
      writeValues([setRecord(PROPOSED_CHANGES, record)]),
    remove: lane =>
      readProposedByLane(doc).has(lane)
        ? writeValues([deleteRecord(PROPOSED_CHANGES, lane)])
        : Promise.resolve(),
    async writeBase(next) {
      if (next === null) return
      const writes = setIfChanged(BASE, next, readBases(doc).get(next.lane))
      if (writes.length === 0) return
      await writeValues(writes)
      // Announced, so a running thread whose base now has news is told.
      input.baseChanged(next.lane)
    },
  }
  return {
    owner: input.owner,
    repoConfig,
    basics,
    piSetup: input.piSetup,
    running: input.running,
    docs: proposedDocs,
    records,
  }
}

/** A jj lane's base record's read of what catching up changes; none for one of another kind. */
const jjCatchUp = (base: BaseRecord | undefined): CatchUpRead | null =>
  base?.kind === "jj" ? base.catchUp : null
