// host/work/create — a new lane: where it works, its record and name, and,
// for a lane of its own, its fork from where it branched, or from accepted work
// or a WIP's copy where nothing is above (ADR-0032, ADR-0034, ADR-0060).

import { stat } from "node:fs/promises"
import {
  BASE_SNAPSHOT,
  ERR,
  type ErrCode,
  type ForkStart,
  type LaneName,
  nearestRevision,
  type Position,
  type WorkSetting,
  type WriterId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import {
  DEFAULT_REPO,
  executeOrThrow,
  planFork,
  removeLane,
  revsetName,
} from "@pinetrie/lanes"
import { type RootView, readRevisions, readTreeIndex } from "@pinetrie/reads"
import { beginFacts, type RepoOwner } from "@pinetrie/repo"
import {
  type ForkBegin,
  forkPoint,
  LANE,
  planBegin,
  setRecord,
} from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import { lockHashAt } from "./disk.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/** Refuse a lane asked to work directly in something that is not a directory. */
export async function checkDirectory(
  work: WorkSetting | null,
): Promise<ErrCode | null> {
  if (work?.kind !== "direct") return null
  const found = await stat(work.dir).catch(() => null)
  return found?.isDirectory() === true ? null : ERR.BAD_DIRECTORY
}

/**
 * What a fork is planned from: the revision nearest above where it branched,
 * and where agent work begins with none above (accepted work, or a WIP's copy).
 * Read only once every turn record being written has been, so a branch at a
 * turn whose snapshot is still running gets that turn's disk.
 */
export async function forkFacts(ports: {
  readonly pendingRecords: Turns["pendingRecords"]
  readonly nearest: () => ReturnType<typeof nearestRevision>
  readonly begin: () => Promise<ForkBegin | ErrCode>
}): Promise<Parameters<typeof forkPoint>[0] | ErrCode> {
  await ports.pendingRecords()
  const above = ports.nearest()
  const begin = await ports.begin()
  return typeof begin === "string" ? begin : { above, begin }
}

export interface NewLanes {
  checkDirectory: typeof checkDirectory
  /**
   * Whether a new lane of its own can begin at `at` from `base` (a WIP
   * bookmark, null for accepted work), checked before the lane is made: null, or
   * why not (ADR-0060). A lane with agent work above inherits it, and needs
   * neither.
   */
  checkBegin(
    view: RootView,
    work: WorkSetting | null,
    at: Position,
    base: string | null,
  ): Promise<ErrCode | null>
  /**
   * Record a new lane in its root (ADR-0063), whatever its work, name it,
   * and, for its own copy, queue its fork.
   */
  prepareLane(
    view: RootView,
    lane: LaneName,
    work: WorkSetting | null,
    at: Position,
    by: WriterId,
    base: string | null,
  ): Promise<void>
}

export function createNewLanes(deps: {
  readonly basics: Basics
  readonly setup: Setup
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly records: Pick<Records, "writeValues">
  readonly ensureNames: () => Promise<void>
  readonly pendingRecords: Turns["pendingRecords"]
}): NewLanes {
  const { basics, setup, registry, keeper } = deps

  const repoConfig = setup.lanes?.repoConfig ?? DEFAULT_REPO

  /**
   * The install to run in a fork from a WIP's copy: the base disk was
   * installed at accepted work's commit, so a WIP whose lockfile differs from it
   * needs its own.
   */
  async function installIfLockMoved(
    owner: RepoOwner,
    start: ForkStart,
  ): Promise<string | null> {
    const install = setup.lanes?.config.install ?? null
    if (install === null || start.kind !== "wip") return null
    return owner.read(async ({ jj }) =>
      (await lockHashAt(jj, start.commit, install.lockfile)) ===
      (await lockHashAt(
        jj,
        `present(${revsetName(repoConfig.acceptedBookmark)})`,
        install.lockfile,
      ))
        ? null
        : install.command,
    )
  }

  /** Where agent work begins for `base`, read from your repo at the head its owner last observed. */
  async function beginAt(owner: RepoOwner, base: string | null) {
    return planBegin({
      base,
      wipPrefix: repoConfig.wipPrefix,
      facts: await owner.read(({ jj }) => beginFacts(jj, repoConfig, base)),
    })
  }

  return {
    checkDirectory,

    async checkBegin(view, work, at, base) {
      const { owner } = setup
      if (work?.kind !== "own" || owner === null) return null
      const { doc } = view
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      if (above.commit !== null) return null
      const begin = await beginAt(owner, base)
      return typeof begin === "string" ? begin : null
    },

    async prepareLane(view, lane, work, at, by, base) {
      const { doc } = view
      await deps.records.writeValues([
        setRecord(LANE, {
          lane,
          root: view.root,
          work,
          by,
          createdAt: basics.now(),
        }),
      ])
      await deps.ensureNames()
      if (work === null) return
      const { owner, paths, ready } = setup
      if (work.kind !== "own" || owner === null || paths === null) return
      const disk = paths
      const handle = registry.handleOf(lane)
      void keeper.track(
        handle.queue
          .enqueue(
            async () => {
              if (ready === null) throw new Error("lanes of their own are off")
              const r = await ready
              const facts = await forkFacts({
                pendingRecords: deps.pendingRecords,
                nearest: () =>
                  nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
                begin: () => beginAt(owner, base),
              })
              if (typeof facts === "string")
                throw new Error(`the lane cannot begin: ${facts}`)
              const point = forkPoint(facts)
              if (point.snapshot === BASE_SNAPSHOT) await setup.baseAtAccepted()
              await removeLane(handle.container)
              await executeOrThrow(
                planFork({
                  point,
                  paths: disk,
                  spec: setup.specOf(lane, r),
                  env: process.env,
                  install: await installIfLockMoved(owner, point.start),
                }),
                handle.runners,
              )
              await handle.start()
            },
            { fatal: true },
          )
          .catch(failed(basics, "forking", lane)),
      )
    },
  }
}
