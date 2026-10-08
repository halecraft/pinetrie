// host/work/containers — each lane's container: started before a run,
// stopped after it (ADR-0034), and where its tools run.

import {
  errorText,
  type LaneName,
  type SnapshotId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import {
  executeOrThrow,
  LANE_NOTE,
  oldNamesOnDisk,
  PINETRIE_MOUNT,
  planContainer,
  planDisk,
  planOldNamesOnDisk,
  planShape,
  planStart,
  planStartFrom,
  RUNTIME_BIN,
  specHashOf,
} from "@pinetrie/lanes"
import type { LaneAccess } from "@pinetrie/pi"
import { readLaneSnapshots, readThreadName } from "@pinetrie/reads"
import { type Basics, failed } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"

const RETIRED =
  "this thread's lane has no disk and no snapshot to start from; branch from it to continue with its files"

export interface Containers {
  /** Where a lane's tools run: its container; null for a lane with no copy of its own. */
  access(lane: LaneName): LaneAccess | null
  /** Before any run: queue a lane of its own's container to start. */
  beforeRun(lane: LaneName): void
  /** After a run: stop its container, and follow its offer. */
  runEnded(lane: LaneName): void
  /**
   * Start a lane's container, as `planContainer` decides. A container made
   * from another spec (image, mounts, grants) is recreated on the same
   * volume. A missing one starts from what `planStartFrom` decides; a disk
   * restored from a snapshot then gets the names the host reads now.
   */
  startContainer(lane: LaneName): Promise<void>
  /** Stop every running lane's container. */
  close(): Promise<void>
}

export function createContainers(deps: {
  readonly basics: Basics
  readonly setup: Setup
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly offers: Offers
}): Containers {
  const { basics, setup, registry, keeper, offers } = deps
  const { session, docs, log } = basics

  /** The snapshots of `lane`'s own records, newest first. */
  async function ownSnapshots(lane: LaneName): Promise<SnapshotId[]> {
    const doc = await docs.laneDoc(lane)
    return doc === null ? [] : readLaneSnapshots(doc, lane)
  }

  /** The newest snapshot of `lane`'s own records that is still there. */
  async function newestSnapshot(lane: LaneName): Promise<SnapshotId | null> {
    const { runtime } = setup
    for (const id of await ownSnapshots(lane))
      if (await runtime.snapshotExists(id)) return id
    return null
  }

  async function startContainer(lane: LaneName): Promise<void> {
    const { ready, runtime } = setup
    const r = await ready
    const handle = registry.handleOf(lane)
    const container = handle.container
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
          // pre-rename: a snapshot of a lane made before the rename holds
          // the old names. A volume needs no such step: the one-off
          // migration renamed those (S114).
          await executeOrThrow(
            planOldNamesOnDisk(await oldNamesOnDisk(handle.runners.lane), lane),
            handle.runners,
          )
          break
        case "retired":
          throw new Error(RETIRED)
      }
    }
    await handle.start()
  }

  return {
    access(lane) {
      // A lane with no copy of its own, or no record, gets no tools.
      if (!registry.isOwn(lane)) return null
      const handle = registry.handleOf(lane)
      const { grants } = setup.lanes.config
      return {
        facts: {
          dir: WORKSPACE_ROOT,
          shared: setup.lanes.shared.map(d => d.path),
          grants: {
            ssh: grants.ssh,
            env: grants.env,
            mounts: grants.mounts.map(m => m.target),
          },
          defaultImage: setup.defaultImage,
          install: PINETRIE_MOUNT,
          note: LANE_NOTE,
        },
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
      const handle = registry.handleOf(lane)
      handle.queue.reset()
      void keeper.track(
        handle.queue
          .enqueue(() => startContainer(lane), { fatal: true })
          .catch(error =>
            log(
              `[host] ${readThreadName(session, lane)} cannot start: ${errorText(error)}`,
            ),
          ),
      )
    },

    runEnded(lane) {
      if (!registry.isOwn(lane)) return
      offers.runEnded(lane)
      const handle = registry.handleOf(lane)
      void keeper.track(
        handle.queue
          .enqueue(() => handle.stop())
          .catch(failed(basics, "stopping", lane)),
      )
    },

    startContainer,

    async close() {
      await registry.stopAll()
    },
  }
}
