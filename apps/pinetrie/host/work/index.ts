// host/work — lanes' containers and disks, as the host carries them out.
//
// The decisions are pure and live in `@pinetrie/core`, `@pinetrie/rules`,
// `@pinetrie/lanes` and `@pinetrie/repo`; these modules gather what they need, call them, and
// execute. What is not in the
// document, in jj, or on a lane's disk is held here: what startup found
// (`Setup`), each lane's handle (`LaneRegistry`), and each coordination set in
// the module that writes it (`turns`' pending records, `update`'s guidance
// flag). Your repo is its owner's (`Setup.owner`, `@pinetrie/repo`); offers are
// `host/offers/`'s, and accepted work `line.ts`'s.

import {
  PROJECT_CONFIG_FILE,
  type ProjectRecord,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { LaneHooks, PiSetup } from "@pinetrie/pi"

import { readRunning } from "@pinetrie/reads"
import type { RepoOwner } from "@pinetrie/repo"
import { refusedAnswer } from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import { type Offers, startOffers } from "../offers/index.ts"
import type { Records } from "../records.ts"
import { type AcceptedWork, createAcceptedWork } from "./accepted.ts"
import { type Archive, createArchive } from "./archive.ts"
import { type Containers, createContainers } from "./containers.ts"
import { createNewLanes, type NewLanes, recordLane } from "./create.ts"
import { createFetches } from "./fetch.ts"
import { createRegistry } from "./registry.ts"
import type { Found } from "./runtime.ts"
import { startSetup } from "./setup.ts"
import { createSharedLineages } from "./shared.ts"
import { startSharedWatch } from "./shared-watch.ts"
import { createSplits, type Splits } from "./split.ts"
import type { PersonalSshPlaces } from "./ssh.ts"
import { createTurns } from "./turns.ts"
import { createUpdates, type Updates } from "./update.ts"

/**
 * Your repo as lane work keeps it, all of it or none: its one writer, which
 * shutdown closes, accepted work in it, and each lane's offer there.
 */
export interface YourRepo {
  readonly owner: RepoOwner
  readonly accepted: AcceptedWork
  readonly offers: Offers
}

/**
 * What the host needs of lane work. Each member is declared, with its doc,
 * in the module that implements it.
 */
export type LaneWork = Pick<
  Containers,
  "access" | "beforeRun" | "runEnded" | "close"
> &
  Pick<NewLanes, "checkBegin" | "prepareLane"> &
  Pick<Updates, "prepareUpdate"> &
  Pick<Splits, "prepareSplit" | "splitEnded"> &
  Archive & {
    /** What the host found where it runs; null when it has no tools. */
    readonly project: ProjectRecord | null
    /** pi's hooks lane work answers; `askSplit` is the documents' (`host/split-call.ts`). */
    readonly hooks: Omit<LaneHooks, "askSplit" | "ask" | "leave">
    /** Your repo, as lane work keeps it; null for a host without tools. */
    readonly repo: YourRepo | null
    /**
     * Settles when every lane's queued steps, fetches and the base snapshot's
     * refresh have, and the owner of your repo has nothing queued, including
     * records they write when they finish.
     */
    quiet(): Promise<void>
    /** `listener` hears each lane whose base record changed. */
    onBaseChanged(listener: (lane: ThreadId) => void): void
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
  /** The user's config, as read at startup: its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  /** Where lane work writes its records. */
  readonly records: Pick<Records, "writeValues">
  /** The person's pi setup: the commands' roots lanes are granted, the skills updates and splits ask for, and descriptions. */
  readonly piSetup: Pick<
    PiSetup,
    "commands" | "agentDir" | "skill" | "complete"
  >
  /** Name every lane that has none (`host/names.ts`): a new lane, before its first run. */
  readonly ensureNames: () => Promise<void>
  /** The directory of the host's ssh socket, which the runtime mounts. */
  readonly sshDir: string
  /** The person's ssh files and agent. */
  readonly personalSsh: PersonalSshPlaces
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
    records: input.records,
    sshDir: input.sshDir,
    personalSsh: input.personalSsh,
  })
  if (setup === null)
    return {
      ...NO_LANES,
      prepareLane: (view, lane, _at, by) =>
        recordLane(
          {
            basics,
            records: input.records,
            ensureNames: input.ensureNames,
          },
          view,
          lane,
          false,
          by,
        ),
    }
  const baseListeners: ((lane: ThreadId) => void)[] = []
  const { owner, runtime } = setup
  const registry = createRegistry({ session, runtime })
  const { repoConfig } = setup.lanes
  /** Accepted work in your repo. */
  const accepted = createAcceptedWork({
    owner,
    basics,
    repoConfig,
    writeValues: writes => input.records.writeValues(writes),
  })
  // The base snapshot follows accepted work, however it moved: setup, an
  // accept, a publish, or jj outside pine·trie.
  owner.onMoved(moved => {
    if (moved.acceptedMoved) setup.refreshBaseSoon()
  })
  /** Each lane's offer in your repo. */
  const offers = startOffers({
    owner,
    repoConfig,
    basics,
    records: input.records,
    piSetup: input.piSetup,
    running: lane => readRunning(basics.live, lane),
    baseChanged: lane => {
      for (const listener of baseListeners) listener(lane)
    },
    acceptedWork: accepted,
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
  const sharedLineages = createSharedLineages({
    basics,
    records: input.records,
  })
  const sharedWatch = startSharedWatch({
    lineages: sharedLineages,
    failed: what => failed(basics, what),
  })
  void sharedWatch
    .sync(setup.configs.accepted().shared)
    .catch(failed(basics, "watching the shared directories"))
  setup.configs.onShared(shared => {
    void sharedWatch
      .sync(shared)
      .catch(failed(basics, "watching the shared directories"))
  })
  const turns = createTurns({
    basics,
    setup,
    registry,
    keeper,
    records: input.records,
    fetchLane,
    shared: sharedLineages,
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
  const archive = createArchive({ basics, offers, runtime, registry, keeper })

  return {
    project: setup.project,
    access: containers.access,
    // One `turns`: the fork waits on the records this `turnDone` adds.
    hooks: {
      turnDone: turns.turnDone,
      askedAboutConflict: updates.askedAboutConflict,
      catchUp: updates.catchUpInRun,
      async configWritten(lane) {
        const { channel } = await registry.handleOf(lane).link()
        const read = await channel.run(
          ["cat", `${WORKSPACE_ROOT}/${PROJECT_CONFIG_FILE}`],
          false,
        )
        return setup.configs.configNote(
          read.code === 0 ? String(read.stdout) : null,
        )
      },
    },
    checkBegin: newLanes.checkBegin,
    prepareLane: newLanes.prepareLane,
    beforeRun: containers.beforeRun,
    runEnded: containers.runEnded,
    prepareUpdate: updates.prepareUpdate,
    prepareSplit: splits.prepareSplit,
    splitEnded: splits.splitEnded,
    repo: { offers, accepted, owner },
    teardown: archive.teardown,
    async quiet() {
      await keeper.idle()
      await owner.idle()
    },
    async close() {
      await sharedWatch.close()
      await containers.close()
      // After the lanes stop: on the Mac, the lease ends and the slot empties.
      await input.found?.close()
    },
    onBaseChanged(listener) {
      baseListeners.push(listener)
    },
  }
}

/** Lane work of a host with no tools: no project, no lanes, no repo; its lanes are recorded all the same. */
const NO_LANES: LaneWork = {
  project: null,
  access: () => {
    throw new Error("the agent has no tools: it works in no lane")
  },
  hooks: {
    turnDone: async () => {},
    askedAboutConflict: async () => false,
    catchUp: async () => refusedAnswer("no-copy"),
    configWritten: async () => null,
  },
  checkBegin: async () => null,
  prepareLane: async () => {},
  beforeRun: () => {},
  runEnded: () => {},
  prepareUpdate: async () => ({
    kind: "refused",
    reason: "the lane has no copy of its own",
  }),
  prepareSplit: async () => ({ refused: "the lane has no copy of its own" }),
  splitEnded: async () => null,
  repo: null,
  teardown: async () => {},
  quiet: async () => {},
  close: async () => {},
  onBaseChanged: () => {},
}
