// host/work — lanes' containers and disks, as the host carries them out
// (ADR-0032 to ADR-0034, ADR-0038).
//
// The decisions are pure and live in core, marginalia and lanes; these
// modules gather what they need, call them, and execute. What is not in the
// document, in jj, or on a lane's disk is held here: what startup found
// (`Setup`), each lane's handle (`LaneRegistry`), and each coordination set in
// the module that writes it (`turns`' pending records, `update`'s guidance
// flag, `fetch`'s queues). Offers are `host/offers/`'s.

import type { ProjectRecord } from "@pineta/core"
import { DEFAULT_LINE } from "@pineta/lanes"
import type { Agent, LaneHooks } from "@pineta/pi"
import { readRunning } from "@pineta/reads"
import type { Basics } from "../basics.ts"
import { type Offers, startOffers } from "../offers/index.ts"
import { createSerial } from "../queue.ts"
import { type Archive, createArchive } from "./archive.ts"
import { type Containers, createContainers } from "./containers.ts"
import { createNewLanes, type NewLanes } from "./create.ts"
import { createFetches } from "./fetch.ts"
import { createRegistry } from "./registry.ts"
import { startSetup } from "./setup.ts"
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
  Pick<Updates, "prepareUpdate" | "landingEnded"> &
  Pick<Splits, "prepareSplit" | "splitEnded"> &
  Archive & {
    /** What the host found where it runs; null when it has no tools. */
    readonly project: ProjectRecord | null
    readonly hooks: LaneHooks
    /** Each lane's offer in your repo; null with no lanes of their own. */
    readonly offers: Offers | null
    /**
     * Settles when every lane's queued steps, fetches and the base snapshot's
     * refresh have, including records they write when they finish.
     */
    quiet(): Promise<void>
  }

/**
 * Find the project, check `container`, and return what the host needs for
 * lanes. `agent` is read lazily: the agent is created with this module's
 * `access` and `hooks`, after it. Images, the lane runtime and the base
 * snapshot are made in the background; a lane's first steps wait for them.
 */
export async function startLaneWork(input: {
  readonly basics: Basics
  /** The directory the host runs from, or null with no tools. */
  readonly dir: string | null
  /** `PINETA_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and `container` is not asked. */
  readonly containers: boolean
  /** The user's config, as read at startup (ADR-0035): its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  readonly agent: () => Agent
  /** Name every lane that has none (`host/names.ts`): a new lane, before its first run. */
  readonly ensureNames: () => Promise<void>
  /**
   * Whether `line` commands are taken (ADR-0060): they act on the repo as its
   * owner, so only on a host that admits no one but this machine.
   */
  readonly lineCommands: boolean
}): Promise<LaneWork> {
  const { basics } = input
  const { doc } = basics
  /** Work nobody awaits, until it settles: what `quiet` waits for. */
  const serial = createSerial()
  const setup = await startSetup({ ...input, basics, serial })
  const { root, paths } = setup
  const registry = createRegistry({ doc, root })
  /** Each lane's offer in your repo (ADR-0038); none without lanes of their own. */
  const offers: Offers | null =
    root === null
      ? null
      : startOffers({
          root,
          line: setup.lanes?.line ?? DEFAULT_LINE,
          lineCommands: input.lineCommands,
          basics,
          agent: input.agent,
          running: lane => readRunning(doc, lane),
          taken: () => setup.refreshBaseSoon(),
        })
  const containers = createContainers({
    basics,
    setup,
    registry,
    serial,
    offers,
    dir: input.dir,
  })
  const { fetchLane } = createFetches({
    basics,
    root,
    registry,
    serial,
    offers,
    startContainer: containers.startContainer,
  })
  const turns = createTurns({
    basics,
    setup,
    registry,
    serial,
    agent: input.agent,
    fetchLane,
  })
  const newLanes = createNewLanes({
    basics,
    setup,
    registry,
    serial,
    agent: input.agent,
    ensureNames: input.ensureNames,
    pendingRecords: turns.pendingRecords,
  })
  const updates = createUpdates({
    basics,
    setup,
    registry,
    agent: input.agent,
    containers,
    fetchLane,
    writeRevision: turns.writeRevision,
  })
  const splits = createSplits({
    basics,
    root,
    registry,
    offers,
    agent: input.agent,
    beforeRun: containers.beforeRun,
    fetchLane,
  })
  const archive = createArchive({ basics, offers, paths, registry, serial })

  return {
    project: setup.project,
    access: containers.access,
    // One `turns` and one `updates`: the fork waits on the records this
    // `turnDone` adds, and `landingEnded` reads the flag this hook sets.
    hooks: {
      turnDone: turns.turnDone,
      askedForGuidance: updates.askedForGuidance,
    },
    checkDirectory: newLanes.checkDirectory,
    checkBegin: newLanes.checkBegin,
    prepareLane: newLanes.prepareLane,
    beforeRun: containers.beforeRun,
    runEnded: containers.runEnded,
    prepareUpdate: updates.prepareUpdate,
    landingEnded: updates.landingEnded,
    prepareSplit: splits.prepareSplit,
    splitEnded: splits.splitEnded,
    offers,
    archived: archive.archived,
    restored: archive.restored,
    async quiet() {
      await serial.idle()
      await offers?.quiet()
    },
    close: containers.close,
  }
}
