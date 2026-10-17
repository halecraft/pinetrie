// host/work — lanes' containers and disks, as the host carries them out.
//
// The decisions are pure and live in `@pinetrie/core`, `@pinetrie/rules` and
// `@pinetrie/lanes`; these modules gather what they need, call them, and
// execute. What is not in the document, in a lane's history, or on a lane's
// disk is held here: what startup found (`Setup`), each lane's handle
// (`LaneRegistry`), and each coordination set in the module that writes it
// (`turns`' pending records, `update`'s guidance flag). Accepted work, proposed
// changes and each lane's history are the project's adapter's (`adapter.ts`),
// which `host/project.ts` chooses by the project's kind: nothing here names
// one.

import type { ConfigPlaces } from "@pinetrie/config"
import {
  type ConflictChoice,
  ERR,
  type ErrCode,
  type ForeignLane,
  PROJECT_CONFIG_FILE,
  type ProjectRecord,
  proveRunnable,
  type ResolvedFact,
  type RunnableLane,
  type ThreadId,
  WORKSPACE_ROOT,
  type WriterId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { LaneHooks, PiSetup } from "@pinetrie/pi"
import { readRunning } from "@pinetrie/reads"
import {
  planResolveCommand,
  refusedAnswer,
  resolveAnswer,
} from "@pinetrie/rules"
import { failed, type LeaseBasics } from "../basics.ts"
import type { Records } from "../records.ts"
import type { HostReport } from "../settings.ts"
import type { Splits, StartedProject } from "./adapter.ts"
import { type Archive, createArchive } from "./archive.ts"
import { type Containers, createContainers } from "./containers.ts"
import { createNewLanes, type NewLanes, recordLane } from "./create.ts"
import type { Destination } from "./destination.ts"
import { createRegistry } from "./registry.ts"
import { type OpenedProject, startSetup } from "./setup.ts"
import { createSharedLineages } from "./shared.ts"
import { startSharedWatch } from "./shared-watch.ts"
import type { PersonalSshPlaces } from "./ssh.ts"
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
  Pick<NewLanes, "checkBegin" | "prepareLane"> &
  Pick<Updates, "prepareUpdate"> &
  Pick<Splits, "prepareSplit" | "splitEnded"> &
  Archive & {
    /** Threads deleted for good: their lanes leave the shared files' lineages. */
    forgetReaders(lanes: ReadonlySet<ThreadId>): Promise<void>
    /** What the host found where it runs; null when it has no tools. */
    readonly project: ProjectRecord | null
    /** pi's hooks lane work answers; `askSplit` is the documents' (`host/split-call.ts`). */
    readonly hooks: Omit<LaneHooks, "askSplit" | "ask" | "leave" | "readBlob">
    /** Accepted work and proposed changes, as the project keeps them; null for a host without tools. */
    readonly destination: Destination | null
    /**
     * Settles when every lane's queued steps, fetches and the base snapshot's
     * refresh have, and the destination has nothing queued, including
     * records they write when they finish.
     */
    quiet(): Promise<void>
    /** `listener` hears each lane whose base record changed. */
    onBaseChanged(listener: (lane: ThreadId) => void): void
    /**
     * A person's choice of `lane`'s conflict's version at `path`, refused
     * while the thread runs: the conflict closed as a state of the lane's,
     * its proposed changes rebuilt. Answers the fact its thread is told.
     */
    resolve(
      lane: ThreadId,
      path: string,
      choose: ConflictChoice,
      by: WriterId,
    ): Promise<
      | { readonly kind: "refused"; readonly code: ErrCode }
      | { readonly kind: "done"; readonly fact: ResolvedFact }
    >
    /**
     * `lane` proven to be one a run may start on (`proveRunnable`), or why
     * not: what every run's start must hold (`Runs.start`).
     */
    runnable(lane: ThreadId): RunnableLane | ForeignLane
  }

/**
 * Return what the host needs for lanes, in the project `findProject` found.
 * The agent is made after this, with its `access` and `hooks`. Images, the
 * lane runtime and the base snapshot are made in the background; a lane's
 * first steps wait for them.
 */
export async function startLaneWork(input: {
  readonly basics: LeaseBasics
  /** The project, opened (`openProject`); null with no tools. */
  readonly project: OpenedProject | null
  /** Accepted work's settled config; null with no tools. */
  readonly report: HostReport | null
  /** pine·trie's own directories, which no lane may mount. */
  readonly places: ConfigPlaces
  /** Where lane work writes its records. */
  readonly records: Pick<Records, "writeValues">
  /** The model setup: the commands' roots lanes are granted, the skills updates and splits ask for, and descriptions. */
  readonly piSetup: Pick<PiSetup, "commands" | "skill" | "complete">
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
    project: input.project,
    report: input.report,
    places: input.places,
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
          null,
          by,
        ),
    }
  const baseListeners: ((lane: ThreadId) => void)[] = []
  const { opened, runtime } = setup
  // The registry asks for a lane's history only from `withHistory`, after
  // startup: `started` is made by then.
  const registry = createRegistry({
    session,
    runtime,
    history: (lane, runners) => started.history(lane, runners),
  })
  // The adapter's fetches start a container only from a queued step, after
  // startup: `containers` is made by then.
  const started: StartedProject = opened.start({
    basics,
    records: input.records,
    piSetup: input.piSetup,
    keeper,
    registry,
    startContainer: (lane, h) => containers.startContainer(lane, h),
    beforeRun: lane => containers.beforeRun(lane),
    acceptedMoved: () => setup.refreshBaseSoon(),
    ready: () => setup.ready.then(() => {}),
    keepStates: () =>
      setup.configs.accepted().report.settled["folder.history.states"].value,
    baseChanged: lane => {
      for (const listener of baseListeners) listener(lane)
    },
  })
  const { destination, splits } = started
  const containers = createContainers({
    basics,
    setup,
    registry,
    keeper,
    proposed: destination.proposed,
  })
  const sharedLineages = createSharedLineages({
    basics,
    records: input.records,
    startedAt: basics.now() * 1000,
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
    destination,
  })
  const updates = createUpdates({
    basics,
    setup,
    destination,
    registry,
    piSetup: input.piSetup,
    containers,
    writeRevision: turns.writeRevision,
  })
  const archive = createArchive({
    basics,
    destination,
    runtime,
    registry,
    keeper,
  })

  return {
    project: setup.project,
    access: containers.access,
    // One `turns`: the fork waits on the records this `turnDone` adds.
    hooks: {
      turnDone: turns.turnDone,
      askedAboutConflict: updates.askedAboutConflict,
      catchUp: updates.catchUpInRun,
      async resolveConflict(lane, path, choose) {
        if (!registry.isOwn(lane))
          return resolveAnswer(path, { kind: "refused", why: "no-copy" })
        return resolveAnswer(
          path,
          await registry.withHistory(lane, h => h.resolve(path, choose, null)),
        )
      },
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
    async resolve(lane, path, choose, by) {
      // gather, plan
      const planned = planResolveCommand({
        own: registry.isOwn(lane),
        running: readRunning(basics.live, lane),
      })
      if (planned.kind === "refused") return planned
      // execute
      // The lane is idle, its container stopped: started for the
      // resolution's snapshot, which syncs inside it, then stopped again.
      const done = await registry.withHistory(lane, async h => {
        await containers.startContainer(lane, h)
        try {
          return await h.resolve(path, choose, by)
        } finally {
          await registry.handleOf(lane).stop()
        }
      })
      if (done.kind === "refused")
        return {
          kind: "refused",
          code: done.why === "markers" ? ERR.REFUSED : ERR.NO_CONFLICT,
        }
      // Its `refreshed` fact is the command's own business, never told.
      await destination.proposed.act(lane, "refresh", by)
      return {
        kind: "done",
        fact: { kind: "resolved", lane, by, path, choose },
      }
    },
    checkBegin: newLanes.checkBegin,
    prepareLane: newLanes.prepareLane,
    beforeRun: containers.beforeRun,
    runEnded: containers.runEnded,
    prepareUpdate: updates.prepareUpdate,
    prepareSplit: splits.prepareSplit,
    splitEnded: splits.splitEnded,
    destination,
    teardown: archive.teardown,
    forgetReaders: lanes => sharedLineages.forgetReaders(lanes),
    async quiet() {
      await keeper.idle()
      await destination.quiet()
    },
    async close() {
      await sharedWatch.close()
      await containers.close()
      // After the lanes stop: on the Mac, the lease ends and the slot empties.
      await input.project?.found.close()
    },
    onBaseChanged(listener) {
      baseListeners.push(listener)
    },
    runnable: lane => proveRunnable(lane, registry.recordOf(lane), opened.kind),
  }
}

/** Lane work of a host with no tools: no project, no lanes, no destination; its lanes are recorded all the same. */
const NO_LANES: LaneWork = {
  project: null,
  access: () => {
    throw new Error("the agent has no tools: it works in no lane")
  },
  hooks: {
    turnDone: async () => {},
    askedAboutConflict: async () => false,
    catchUp: async () => refusedAnswer("no-copy"),
    resolveConflict: async path =>
      resolveAnswer(path, { kind: "refused", why: "no-copy" }),
    configWritten: async () => null,
  },
  checkBegin: async () => null,
  prepareLane: async () => {},
  resolve: async () => ({ kind: "refused", code: ERR.NOT_OWN_COPY }),
  beforeRun: () => {},
  runEnded: () => {},
  prepareUpdate: async () => ({
    kind: "refused",
    reason: "the lane has no copy of its own",
  }),
  prepareSplit: async () => ({ refused: "the lane has no copy of its own" }),
  splitEnded: async () => null,
  destination: null,
  teardown: async () => {},
  // No lineage is written without tools: there is no lane to forget.
  forgetReaders: async () => {},
  quiet: async () => {},
  close: async () => {},
  onBaseChanged: () => {},
  // Every lane runs with no tools here, whatever its history.
  runnable: lane => proveRunnable(lane, undefined, null),
}
