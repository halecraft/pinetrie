// host/work/containers — each lane's container: started before a run, stopped
// after it, and where its tools run.

import {
  errorText,
  type OwnLane,
  type ProjectKind,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import { PINETRIE_MOUNT } from "@pinetrie/install"
import type { Keeper } from "@pinetrie/keeper"
import {
  decideLaneStart,
  executeOrThrow,
  innerDockerDataRootStep,
  KILL_SSH,
  type LaneFactReader,
  type LaneGrants,
  type LaneHistory,
  type LaneSpec,
  type LaneStartWithStoppedContainer,
  laneNote,
  nestedLaneDockerNote,
  planContainer,
  planDisk,
  planShape,
  planStart,
  RUNTIME_BIN,
  shapeSpecHash,
} from "@pinetrie/lanes"
import type { LaneAccess, LaneFacts } from "@pinetrie/pi"
import {
  readLaneForks,
  readLaneRevisions,
  readRunning,
  readThreadName,
} from "@pinetrie/reads"
import { failed, type LeaseBasics } from "../basics.ts"
import type { NewLanes } from "./create.ts"
import type { ProposedChangesActs } from "./destination.ts"
import { removeStaleOutputs } from "./disk.ts"
import type { InnerDockerDataRootsHeld } from "./inner-docker-data-roots.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"

/** What a lane of its own is told about itself, from what the host holds for it. */
export function laneFacts(input: {
  readonly grants: LaneGrants
  readonly ssh: LaneFacts["grants"]["ssh"]
  readonly shared: readonly string[]
  readonly defaultImage: boolean
  readonly kind: ProjectKind
}): LaneFacts {
  const { grants } = input
  return {
    dir: WORKSPACE_ROOT,
    shared: input.shared,
    // Every grant is told, or excluded by name in the `satisfies` type. The
    // literal stays inline: only there does tsc also refuse a key that
    // `LaneFacts` lacks. Host ports are excluded: whether `$PINETRIE_HOST` is
    // set depends on the runtime's target, which this does not see. `nested`
    // is told under a name of its own, as the path of the note on its Docker.
    grants: {
      ssh: input.ssh,
      nestedDockerNote: grants.nested ? nestedLaneDockerNote : null,
      env: grants.env,
      mounts: grants.mounts.map(m => m.target),
    } satisfies Record<
      Exclude<keyof LaneGrants, "hostPorts" | "nested">,
      unknown
    > & { readonly nestedDockerNote: string | null },
    defaultImage: input.defaultImage,
    install: PINETRIE_MOUNT,
    note: laneNote(input.kind),
  }
}

const RETIRED =
  "this thread's lane has no disk and no snapshot to start from; branch from it to continue with its files"

export interface Containers {
  /** Where a lane's tools run: its container; null for a lane with no copy of its own. */
  access(lane: ThreadId): LaneAccess | null
  /** Before any run: queue a lane of its own's container to start. */
  beforeRun(lane: ThreadId): void
  /** After a run: stop its container, and follow its proposed changes. */
  runEnded(lane: ThreadId): void
  /**
   * Start a lane's container, as `planLaneStart` decides from its fork's
   * record and its container (`planContainer`): a fork owed runs; a container
   * made from another spec (image, mounts, grants) is recreated on the same
   * volume; a missing one starts from its disk, else a snapshot, whose disk
   * then gets what its history needs (`LaneHistory.afterRestore`). Run from a
   * step on the lane's queue, which holds `h`.
   */
  startContainer(record: OwnLane, h: LaneHistory): Promise<void>
  /** Stop every running lane's container. */
  close(): Promise<void>
}

export function createContainers(deps: {
  readonly basics: LeaseBasics
  readonly setup: Setup
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly proposed: Pick<ProposedChangesActs, "runEnded">
  /** A lane's fork (`work/create.ts`), run by its start. */
  readonly fork: NewLanes["fork"]
  readonly innerDockerDataRoots: InnerDockerDataRootsHeld
}): Containers {
  const { basics, setup, registry, keeper, proposed, innerDockerDataRoots } =
    deps
  const { session, log } = basics

  // A lane whose use of its owner's identity is taken back: its sessions
  // through the host are closed already; any that went around the host end
  // here, if it runs.
  setup.ssh.onNews((lane, news) => {
    if (news.kind !== "taken-back") return
    if (!registry.isOwn(lane) || !readRunning(basics.live, lane)) return
    void keeper.track(
      registry
        .handleOf(lane)
        .runners.lane(KILL_SSH.argv)
        .catch(failed(basics, "ending ssh sessions", lane)),
    )
  })

  /**
   * What a begun lane's start reads once its container must be made, each
   * fact only when its plan asks: its disk; its revision records'
   * snapshots, whether it has any, and its history's kept snapshot; and
   * whether a snapshot is there, one at a time.
   */
  const factsOf = (lane: ThreadId, h: LaneHistory): LaneFactReader => ({
    disk: () => setup.runtime.diskExists(lane),
    async history() {
      await using held = basics.leases.lane(lane)
      const [revisions, kept] = await Promise.all([
        held === null
          ? []
          : held.ready.then(doc => readLaneRevisions(doc, lane)),
        h.keptSnapshot(),
      ])
      return {
        own: revisions.flatMap(r => (r.snapshot === null ? [] : [r.snapshot])),
        recorded: revisions.length > 0,
        kept,
      }
    },
    snapshotExists: snapshot => setup.runtime.snapshotExists(snapshot),
  })

  /**
   * A nested lane's inner Docker data root, made from the last run's lane's
   * before its container starts: `start` is one whose container is stopped
   * or not yet made, so no inner Docker runs on it.
   */
  async function makeInnerDockerDataRoot(
    spec: LaneSpec,
    start: LaneStartWithStoppedContainer,
    runners: Parameters<typeof executeOrThrow>[1],
  ): Promise<void> {
    const source = innerDockerDataRoots.sourceAtStart(spec.lane)
    const step = innerDockerDataRootStep(spec, start, source)
    if (step === null) return
    await executeOrThrow([step], runners)
    innerDockerDataRoots.made(spec.lane, source)
  }

  async function startContainer(
    record: OwnLane,
    h: LaneHistory,
  ): Promise<void> {
    const { lane } = record
    const { runtime } = setup
    const handle = registry.handleOf(lane)
    const { container } = handle
    // Its own pinetrie.json may narrow what it gets: a narrowing changes the
    // spec, so the container is made anew below.
    await setup.configs.readLane(lane)
    const spec = setup.specOf(lane)
    // Read in this step, never when it was queued: a fork queued before it
    // may have ended since. `withHistory` refused a lane with none.
    const fork = readLaneForks(session).get(lane)
    if (fork === undefined)
      throw new Error(`${readThreadName(session, lane)} has no fork record`)
    const containerPlan = planContainer({
      facts: await runtime.containerFacts(container),
      want: shapeSpecHash(runtime, planShape(spec, process.env)),
    })
    const decided = await decideLaneStart(
      { fork: fork.state, container: containerPlan },
      factsOf(lane, h),
    )
    switch (decided.kind) {
      case "fork":
        // A fork stopped part way may have left its container running, its
        // link open: the fork deletes it.
        if (containerPlan !== "create") await handle.stop()
        await deps.fork(lane, h, handle, record, fork)
        break
      case "container":
        if (decided.plan === "start")
          await makeInnerDockerDataRoot(
            spec,
            { kind: "container", plan: "start" },
            handle.runners,
          )
        await handle.start(decided.plan === "start" ? "stopped" : "running")
        break
      case "disk":
      case "snapshot":
        if (decided.recreate) {
          await handle.stop()
          await runtime.remove(container)
        }
        await makeInnerDockerDataRoot(spec, decided, handle.runners)
        if (decided.kind === "disk")
          await executeOrThrow([planStart(spec, process.env)], handle.runners)
        else {
          await executeOrThrow(
            planDisk({ spec, env: process.env, from: decided.from }),
            handle.runners,
          )
          await h.afterRestore()
        }
        // Made just now: running.
        await handle.start("running")
        break
      case "retired":
        throw new Error(RETIRED)
    }
    // Every run starts on a disk whose recipes are checked, whatever made it
    // (a fork, a restore, a merge, another image): what went stale goes.
    await removeStaleOutputs(handle, setup.ready.image).catch(
      failed(basics, "removing stale outputs", lane),
    )
  }

  return {
    access(lane) {
      // A lane with no copy of its own, or no record, gets no tools.
      const history = registry.recordOf(lane)?.history ?? null
      if (history === null) return null
      const handle = registry.handleOf(lane)
      return {
        facts: laneFacts({
          grants: setup.configs.laneConfig(lane).grants,
          ssh: setup.ssh.holdsFor(lane),
          shared: setup.configs.laneShared(lane).map(d => d.path),
          defaultImage: setup.defaultImage,
          kind: history,
        }),
        hostPaths: setup.hostPaths,
        programs: RUNTIME_BIN,
        gate: async () => {
          await handle.queue.idle()
          return (await handle.link()).channel
        },
      }
    },

    beforeRun(lane) {
      if (!registry.isOwn(lane)) return
      registry.handleOf(lane).queue.reset()
      void keeper.track(
        registry
          .withHistory(lane, (h, _, record) => startContainer(record, h), {
            fatal: true,
          })
          .catch(error =>
            log(
              `[host] ${readThreadName(session, lane)} cannot start: ${errorText(error)}`,
            ),
          ),
      )
    },

    runEnded(lane) {
      if (!registry.isOwn(lane)) return
      proposed.runEnded(lane)
      const handle = registry.handleOf(lane)
      void keeper.track(
        handle.queue
          .enqueue(async () => {
            await handle.stop()
            // Stopped: from now its inner Docker data root is the one to
            // clone, and no Docker runs on it unless it starts again.
            if (setup.specOf(lane).grants.nested)
              innerDockerDataRoots.stoppedAfterRun(lane)
          })
          .catch(failed(basics, "stopping", lane)),
      )
    },

    startContainer,

    async close() {
      await setup.ssh.close()
      await registry.stopAll()
    },
  }
}
