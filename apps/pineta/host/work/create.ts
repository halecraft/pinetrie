// host/work/create — a new lane: where it works, its record and name, and,
// for a lane of its own, its fork from where it branched, or from the line
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
} from "@pineta/core"
import {
  beginFacts,
  DEFAULT_LINE,
  executeOrThrow,
  hostJj,
  planFork,
  removeLane,
  revsetName,
} from "@pineta/lanes"
import {
  type ForkBegin,
  forkPoint,
  LANE,
  planBegin,
  setRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readRevisions, readTreeIndex } from "@pineta/reads"
import { type Basics, failed } from "../basics.ts"
import type { Serial } from "../queue.ts"
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
 * and where agent work begins with none above (the line, or a WIP's copy).
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
   * bookmark, null for the line), checked before the lane is made: null, or
   * why not (ADR-0060). A lane with agent work above inherits it, and needs
   * neither.
   */
  checkBegin(
    work: WorkSetting | null,
    at: Position,
    base: string | null,
  ): Promise<ErrCode | null>
  /** Record a new lane, name it, and, for its own copy, queue its fork. */
  prepareLane(
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
  readonly serial: Serial
  readonly agent: () => Agent
  readonly ensureNames: () => Promise<void>
  readonly pendingRecords: Turns["pendingRecords"]
}): NewLanes {
  const { basics, setup, registry, serial } = deps
  const { doc } = basics

  const line = setup.lanes?.line ?? DEFAULT_LINE

  /**
   * The install to run in a fork from a WIP's copy: the base disk was
   * installed at the line's commit, so a WIP whose lockfile differs from it
   * needs its own.
   */
  async function installIfLockMoved(
    at: string,
    start: ForkStart,
  ): Promise<string | null> {
    const install = setup.lanes?.config.install ?? null
    if (install === null || start.kind !== "wip") return null
    const jj = hostJj(at)
    return (await lockHashAt(jj, start.commit, install.lockfile)) ===
      (await lockHashAt(
        jj,
        `present(${revsetName(line.onto)})`,
        install.lockfile,
      ))
      ? null
      : install.command
  }

  /** Where agent work begins for `base`, read from your repo now. */
  async function beginAt(root: string, base: string | null) {
    return planBegin({
      base,
      onto: line.onto,
      wipPrefix: line.wipPrefix,
      facts: await beginFacts(hostJj(root), line, base),
    })
  }

  return {
    checkDirectory,

    async checkBegin(work, at, base) {
      const { root } = setup
      if (work?.kind !== "own" || root === null) return null
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      if (above.commit !== null) return null
      const begin = await beginAt(root, base)
      return typeof begin === "string" ? begin : null
    },

    async prepareLane(lane, work, at, by, base) {
      if (work !== null)
        await deps
          .agent()
          .writeValues([
            setRecord(LANE, { lane, work, by, createdAt: basics.now() }),
          ])
      await deps.ensureNames()
      if (work === null) return
      const { root, paths, ready } = setup
      if (work.kind !== "own" || root === null || paths === null) return
      const [at0, disk] = [root, paths]
      const handle = registry.handleOf(lane)
      void serial.track(
        handle.queue
          .enqueue(
            async () => {
              if (ready === null) throw new Error("lanes of their own are off")
              const r = await ready
              const facts = await forkFacts({
                pendingRecords: deps.pendingRecords,
                nearest: () =>
                  nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
                begin: () => beginAt(at0, base),
              })
              if (typeof facts === "string")
                throw new Error(`the lane cannot begin: ${facts}`)
              const point = forkPoint(facts)
              if (point.snapshot === BASE_SNAPSHOT) await setup.baseAtLine()
              await removeLane(handle.container)
              await executeOrThrow(
                planFork({
                  point,
                  paths: disk,
                  spec: setup.specOf(lane, r),
                  env: process.env,
                  install: await installIfLockMoved(at0, point.start),
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
