// host/work/containers — each lane's container: started before a run, stopped
// after it, and where its tools run.

import {
  errorText,
  type ProjectKind,
  type SnapshotId,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import {
  executeOrThrow,
  KILL_SSH,
  type LaneGrants,
  type LaneHistory,
  laneNote,
  PINETRIE_MOUNT,
  planContainer,
  planDisk,
  planShape,
  planStart,
  planStartFrom,
  RUNTIME_BIN,
  specHashOf,
} from "@pinetrie/lanes"
import type { LaneAccess, LaneFacts } from "@pinetrie/pi"
import { readLaneSnapshots, readRunning, readThreadName } from "@pinetrie/reads"
import { type Basics, failed } from "../basics.ts"
import type { ProposedChangesActs } from "./destination.ts"
import { removeStaleOutputs } from "./disk.ts"
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
    // set depends on the runtime's target, which this does not see.
    grants: {
      ssh: input.ssh,
      nested: grants.nested,
      env: grants.env,
      mounts: grants.mounts.map(m => m.target),
    } satisfies Record<Exclude<keyof LaneGrants, "hostPorts">, unknown>,
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
   * Start a lane's container, as `planContainer` decides. A container made
   * from another spec (image, mounts, grants) is recreated on the same
   * volume. A missing one starts from what `planStartFrom` decides; a disk
   * restored from a snapshot then gets what its history needs
   * (`LaneHistory.afterRestore`). Run from a step on the lane's queue, which
   * holds `h`.
   */
  startContainer(lane: ThreadId, h: LaneHistory): Promise<void>
  /** Stop every running lane's container. */
  close(): Promise<void>
}

export function createContainers(deps: {
  readonly basics: Basics
  readonly setup: Setup
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly proposed: Pick<ProposedChangesActs, "runEnded">
}): Containers {
  const { basics, setup, registry, keeper, proposed } = deps
  const { session, docs, log } = basics

  // A lane whose use of its owner's identity is taken back: its sessions
  // through the host are closed already; any that went around the host end
  // here, if it runs.
  setup.ssh.onCut(lane => {
    if (!registry.isOwn(lane) || !readRunning(basics.live, lane)) return
    void keeper.track(
      registry
        .handleOf(lane)
        .runners.lane(KILL_SSH.argv)
        .catch(failed(basics, "ending ssh sessions", lane)),
    )
  })

  /** The snapshots of `lane`'s own records, newest first. */
  async function ownSnapshots(lane: ThreadId): Promise<SnapshotId[]> {
    const doc = await docs.laneDoc(lane)
    return doc === null ? [] : readLaneSnapshots(doc, lane)
  }

  /** The newest snapshot of `lane`'s own records that is still there. */
  async function newestSnapshot(lane: ThreadId): Promise<SnapshotId | null> {
    const { runtime } = setup
    for (const id of await ownSnapshots(lane))
      if (await runtime.snapshotExists(id)) return id
    return null
  }

  async function startContainer(lane: ThreadId, h: LaneHistory): Promise<void> {
    const { ready, runtime } = setup
    const r = await ready
    const handle = registry.handleOf(lane)
    const container = handle.container
    // Its own pinetrie.json may narrow what it gets: a narrowing changes the
    // spec, so the container is made anew below.
    await setup.configs.readLane(lane)
    const spec = setup.specOf(lane, r)
    const decided = planContainer({
      facts: await runtime.containerFacts(container),
      want: specHashOf(runtime, planShape(spec, process.env)),
    })
    if (decided === "recreate") {
      await handle.stop()
      await runtime.remove(container)
    }
    if (decided === "create" || decided === "recreate") {
      const disk = await runtime.diskExists(lane)
      const newest = disk ? null : await newestSnapshot(lane)
      const from = planStartFrom({ disk, newest })
      switch (from.kind) {
        case "disk":
          await executeOrThrow([planStart(spec, process.env)], handle.runners)
          break
        case "snapshot":
          await executeOrThrow(
            planDisk({ spec, env: process.env, from: from.from }),
            handle.runners,
          )
          await h.afterRestore()
          break
        case "retired":
          throw new Error(RETIRED)
      }
    }
    // Made just now, or read above: running unless it was stopped.
    await handle.start(decided === "start" ? "stopped" : "running")
    // Every run starts on a disk whose recipes are checked, whatever made it
    // (a fork, a restore, a merge, another image): what went stale goes.
    await removeStaleOutputs(handle, r.image).catch(
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
          .withHistory(lane, h => startContainer(lane, h), { fatal: true })
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
          .enqueue(() => handle.stop())
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
