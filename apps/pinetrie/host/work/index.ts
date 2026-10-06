// host/work — lanes' containers and disks, as the host carries them out
// (ADR-0032 to ADR-0034, ADR-0038).
//
// The decisions are pure and live in `@pinetrie/core`, `@pinetrie/rules`,
// `@pinetrie/lanes` and `@pinetrie/repo`; these modules gather what they need, call them, and
// execute. What is not in the
// document, in jj, or on a lane's disk is held here: what startup found
// (`Setup`), each lane's handle (`LaneRegistry`), and each coordination set in
// the module that writes it (`turns`' pending records, `update`'s guidance
// flag). Your repo is its owner's (`Setup.owner`, `@pinetrie/repo`); offers are
// `host/offers/`'s, and the integration line `line.ts`'s.

import type { LaneName, ProjectRecord } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { DEFAULT_LINE } from "@pinetrie/lanes"
import type { LaneHooks, PiSetup } from "@pinetrie/pi"
import { readRunning } from "@pinetrie/reads"
import type { RepoOwner } from "@pinetrie/repo"
import type { Basics } from "../basics.ts"
import { type Offers, startOffers } from "../offers/index.ts"
import type { Records } from "../records.ts"
import { type Archive, createArchive } from "./archive.ts"
import { type Containers, createContainers } from "./containers.ts"
import { createNewLanes, type NewLanes } from "./create.ts"
import { createFetches } from "./fetch.ts"
import { createLine, type Line } from "./line.ts"
import { createRegistry } from "./registry.ts"
import { type Found, startSetup } from "./setup.ts"
import { createSplits, type Splits } from "./split.ts"
import { createTurns } from "./turns.ts"
import { createUpdates, type Updates } from "./update.ts"

/**
 * What the host needs of lane work. Each member is declared, with its doc,
 * in the module that implements it.
 */
export type LaneWork = Pick<
  Containers,
  "access" | "beforeRun" | "runEnded" | "close"
> &
  Pick<NewLanes, "checkDirectory" | "checkBegin" | "prepareLane"> &
  Pick<Updates, "prepareUpdate"> &
  Pick<Splits, "prepareSplit" | "splitEnded"> &
  Archive & {
    /** What the host found where it runs; null when it has no tools. */
    readonly project: ProjectRecord | null
    /** pi's hooks lane work answers; `askSplit` is the documents' (`host/split-call.ts`). */
    readonly hooks: Omit<LaneHooks, "askSplit">
    /** Each lane's offer in your repo; null with no lanes of their own. */
    readonly offers: Offers | null
    /** The integration line in your repo (ADR-0060); null with no lanes of their own. */
    readonly line: Line | null
    /** The one writer of your repo (ADR-0065); null with no lanes of their own. Shutdown closes it. */
    readonly owner: RepoOwner | null
    /**
     * Settles when every lane's queued steps, fetches and the base snapshot's
     * refresh have, and the owner of your repo has nothing queued, including
     * records they write when they finish.
     */
    quiet(): Promise<void>
    /** `listener` hears each lane whose base record changed (ADR-0080). */
    onBaseChanged(listener: (lane: LaneName) => void): void
  }

/**
 * Return what the host needs for lanes, in the project `findProject` found.
 * The agent is made after this, with its `access` and `hooks`. Images, the
 * lane runtime and the base snapshot are made in the background; a lane's
 * first steps wait for them.
 */
export async function startLaneWork(input: {
  readonly basics: Basics
  /** What `findProject` found; null with no tools. */
  readonly found: Found | null
  /** The user's config, as read at startup (ADR-0035): its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  /** Where lane work writes its records (ADR-0062). */
  readonly records: Pick<Records, "writeValues">
  /** The person's pi setup: the commands' roots lanes are granted, the skills updates and splits ask for, and descriptions. */
  readonly piSetup: Pick<
    PiSetup,
    "commands" | "agentDir" | "skill" | "complete"
  >
  /** Name every lane that has none (`host/names.ts`): a new lane, before its first run. */
  readonly ensureNames: () => Promise<void>
  /**
   * Whether `line` commands are accepted (ADR-0060): they act on the repo as its
   * owner, so only on a host that admits no one but this machine.
   */
  readonly lineCommands: boolean
}): Promise<LaneWork> {
  const { basics } = input
  const { session } = basics
  /** Work nobody awaits, until it settles: what `quiet` waits for. */
  const keeper = createKeeper()
  const setup = await startSetup({
    basics,
    found: input.found,
    userConfig: input.userConfig,
    setup: input.piSetup,
    keeper,
  })
  const baseListeners: ((lane: LaneName) => void)[] = []
  const { root, owner, paths } = setup
  const registry = createRegistry({ session, root })
  const lineConfig = setup.lanes?.line ?? DEFAULT_LINE
  /** The integration line in your repo (ADR-0060); none without lanes of their own. */
  const line: Line | null =
    owner === null
      ? null
      : createLine({
          owner,
          basics,
          line: lineConfig,
          lineCommands: input.lineCommands,
          writeValues: writes => input.records.writeValues(writes),
        })
  // The base snapshot follows the line, however it moved: setup, an accept,
  // a publish, or jj outside pine·trie (ADR-0090).
  owner?.onMoved(moved => {
    if (moved.onto) setup.refreshBaseSoon()
  })
  /** Each lane's offer in your repo (ADR-0038); none without lanes of their own. */
  const offers: Offers | null =
    owner === null || line === null
      ? null
      : startOffers({
          owner,
          line: lineConfig,
          basics,
          records: input.records,
          piSetup: input.piSetup,
          running: lane => readRunning(basics.live, lane),
          baseChanged: lane => {
            for (const listener of baseListeners) listener(lane)
          },
          lineWork: line,
        })
  const containers = createContainers({
    basics,
    setup,
    registry,
    keeper,
    offers,
  })
  const { fetchLane } = createFetches({
    basics,
    owner,
    registry,
    keeper,
    startContainer: containers.startContainer,
  })
  const turns = createTurns({
    basics,
    setup,
    registry,
    keeper,
    records: input.records,
    fetchLane,
  })
  const newLanes = createNewLanes({
    basics,
    setup,
    registry,
    keeper,
    records: input.records,
    ensureNames: input.ensureNames,
    pendingRecords: turns.pendingRecords,
  })
  const updates = createUpdates({
    basics,
    setup,
    registry,
    piSetup: input.piSetup,
    containers,
    fetchLane,
    writeRevision: turns.writeRevision,
  })
  const splits = createSplits({
    basics,
    owner,
    registry,
    offers,
    piSetup: input.piSetup,
    beforeRun: containers.beforeRun,
    fetchLane,
  })
  const archive = createArchive({ basics, offers, paths, registry, keeper })

  return {
    project: setup.project,
    access: containers.access,
    // One `turns`: the fork waits on the records this `turnDone` adds.
    hooks: {
      turnDone: turns.turnDone,
      askedAboutConflict: updates.askedAboutConflict,
      catchUp: updates.catchUpInRun,
    },
    checkDirectory: newLanes.checkDirectory,
    checkBegin: newLanes.checkBegin,
    prepareLane: newLanes.prepareLane,
    beforeRun: containers.beforeRun,
    runEnded: containers.runEnded,
    prepareUpdate: updates.prepareUpdate,
    prepareSplit: splits.prepareSplit,
    splitEnded: splits.splitEnded,
    offers,
    line,
    owner,
    teardown: archive.teardown,
    async quiet() {
      await keeper.idle()
      await owner?.idle()
    },
    close: containers.close,
    onBaseChanged(listener) {
      baseListeners.push(listener)
    },
  }
}
