// host/work/containers — each lane's container: started before a run,
// stopped and trimmed after it (ADR-0034), and where its tools run.

import { type LaneName, type SnapshotId, WORKSPACE_ROOT } from "@pineta/core"
import type { Keeper } from "@pineta/keeper"
import {
  containerFacts,
  executeOrThrow,
  LANE_NOTE,
  NO_GRANTS,
  PINETA_MOUNT,
  planContainer,
  planDisk,
  planStart,
  planStartFrom,
  RUNTIME_BIN,
  removeContainer,
  snapshotExists,
  specHashOf,
  trim,
  volumeExists,
} from "@pineta/lanes"
import type { LaneAccess } from "@pineta/pi"
import { readRevisions, readThreadName } from "@pineta/reads"
import { type Basics, failed, messageOf } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"

const RETIRED =
  "this thread's lane predates lane containers (ADR-0034); branch from it to continue with its files"

export interface Containers {
  /** Where a lane's tools run: its container, or a directory on the host. */
  access(lane: LaneName): LaneAccess
  /** Before any run: queue a lane of its own's container to start. */
  beforeRun(lane: LaneName): void
  /** After a run: stop its container, trim its disk, and follow its offer. */
  runEnded(lane: LaneName): void
  /**
   * Start a lane's container, as `planContainer` decides. A container made
   * from another spec (image, mounts, grants) is recreated on the same
   * volume. A missing one starts from what `planStartFrom` decides.
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
  readonly offers: Offers | null
  /** The directory the host runs from, or null with no tools. */
  readonly dir: string | null
}): Containers {
  const { basics, setup, registry, keeper, offers } = deps
  const { session, docs, log } = basics

  /** The newest snapshot of `lane`'s own records whose file is still there. */
  async function newestSnapshot(lane: LaneName): Promise<SnapshotId | null> {
    if (setup.paths === null) return null
    const doc = await docs.laneDoc(lane)
    if (doc === null) return null
    const own = [...readRevisions(doc).values()]
      .filter(r => r.lane === lane && r.snapshot !== null)
      .sort((a, b) => (a.entry < b.entry ? 1 : -1))
    for (const r of own)
      if (
        r.snapshot !== null &&
        (await snapshotExists(setup.paths, r.snapshot))
      )
        return r.snapshot
    return null
  }

  async function startContainer(lane: LaneName): Promise<void> {
    const { ready, root, paths } = setup
    if (ready === null || root === null || paths === null)
      throw new Error("lanes of their own are off for this host")
    const r = await ready
    const handle = registry.handleOf(lane)
    const container = handle.container
    const spec = setup.specOf(lane, r)
    const decided = planContainer({
      facts: await containerFacts(container),
      want: specHashOf(spec, process.env),
    })
    if (decided === "recreate") {
      await handle.stop()
      await removeContainer(container)
    }
    if (decided === "create" || decided === "recreate") {
      const volume = await volumeExists(container)
      const newest = volume ? null : await newestSnapshot(lane)
      const from = planStartFrom({ volume, newest })
      switch (from.kind) {
        case "volume":
          await executeOrThrow([planStart(spec, process.env)], handle.runners)
          break
        case "snapshot":
          await executeOrThrow(
            planDisk({ paths, spec, env: process.env, from: from.from }),
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
      const record = registry.recordOf(lane)
      if (record?.work?.kind === "direct")
        return {
          kind: "direct",
          dir: record.work.dir,
          ready: Promise.resolve(),
        }
      // A lane with no record, or a lane of its own where containers are
      // unavailable, works in the project.
      if (record === undefined || !registry.isOwn(lane))
        return {
          kind: "direct",
          dir: setup.project?.root ?? deps.dir ?? process.cwd(),
          ready: Promise.resolve(),
        }
      const handle = registry.handleOf(lane)
      const grants = setup.lanes?.config.grants ?? NO_GRANTS
      return {
        kind: "lane",
        facts: {
          dir: WORKSPACE_ROOT,
          shared: setup.lanes?.shared.map(d => d.path) ?? [],
          grants: {
            ssh: grants.ssh,
            env: grants.env,
            mounts: grants.mounts.map(m => m.target),
          },
          defaultImage: setup.defaultImage,
          install: PINETA_MOUNT,
          note: LANE_NOTE,
        },
        hostPaths: setup.hostPaths(),
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
              `[host] ${readThreadName(session, lane)} cannot start: ${messageOf(error)}`,
            ),
          ),
      )
    },

    runEnded(lane) {
      const { ready } = setup
      if (!registry.isOwn(lane) || ready === null) return
      offers?.runEnded(lane)
      const handle = registry.handleOf(lane)
      void keeper.track(
        handle.queue
          .enqueue(async () => {
            await handle.stop()
            await trim(handle.container, (await ready).tools)
          })
          .catch(failed(basics, "stopping or trimming", lane)),
      )
    },

    startContainer,

    async close() {
      await registry.stopAll()
    },
  }
}
