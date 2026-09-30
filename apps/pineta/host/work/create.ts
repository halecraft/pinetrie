// host/work/create — a new lane: where it works, its record and name, and,
// for a lane of its own, its fork from where it branched (ADR-0032,
// ADR-0034, ADR-0038).

import { stat } from "node:fs/promises"
import {
  BASE_SNAPSHOT,
  type CommitId,
  ERR,
  type ErrCode,
  type LaneName,
  nearestRevision,
  type Position,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import {
  bookmarkOf,
  executeOrThrow,
  hostJj,
  planFork,
  removeLane,
  yoursAt,
} from "@pineta/lanes"
import { forkPoint } from "@pineta/marginalia"
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
 * and your `@`. Read only once every turn record being written has been, so
 * a branch at a turn whose snapshot is still running gets that turn's disk.
 */
export async function forkFacts(ports: {
  readonly pendingRecords: Turns["pendingRecords"]
  readonly nearest: () => ReturnType<typeof nearestRevision>
  readonly yours: () => ReturnType<typeof yoursAt>
}): Promise<Parameters<typeof forkPoint>[0]> {
  await ports.pendingRecords()
  const above = ports.nearest()
  return { above, yours: await ports.yours() }
}

/** A copy of your `@` made in a lane: a commit you have (ADR-0038). */
export const writeCopy = (
  agent: Pick<Agent, "setWorkRecord">,
  lane: LaneName,
  commit: CommitId,
  at: number,
) =>
  agent.setWorkRecord({
    kind: "have",
    record: { lane, commit, kind: "copy", at },
  })

export interface NewLanes {
  checkDirectory: typeof checkDirectory
  /** Record a new lane, name it, and, for its own copy, queue its fork. */
  prepareLane(
    lane: LaneName,
    work: WorkSetting | null,
    at: Position,
    by: WriterId,
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

  /**
   * The install to run in a fork from a copy of your `@`: the base disk was
   * installed at your `@-`, so a lockfile you changed since needs its own.
   */
  async function installIfLockMoved(at: string): Promise<string | null> {
    const install = setup.lanes?.config.install ?? null
    if (install === null) return null
    const jj = hostJj(at)
    return (await lockHashAt(jj, "@", install.lockfile)) ===
      (await lockHashAt(jj, "@-", install.lockfile))
      ? null
      : install.command
  }

  return {
    checkDirectory,

    async prepareLane(lane, work, at, by) {
      if (work !== null)
        await deps.agent().setWorkRecord({
          kind: "lane",
          record: { lane, work, by, createdAt: basics.now() },
        })
      await deps.ensureNames()
      if (work === null) return
      const { root, paths, ready } = setup
      if (work.kind !== "own" || root === null || paths === null) return
      const [base, disk] = [root, paths]
      const handle = registry.handleOf(lane)
      void serial.track(
        handle.queue
          .enqueue(
            async () => {
              if (ready === null) throw new Error("lanes of their own are off")
              const r = await ready
              const point = forkPoint(
                await forkFacts({
                  pendingRecords: deps.pendingRecords,
                  nearest: () =>
                    nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
                  yours: () => yoursAt(hostJj(base)),
                }),
              )
              await removeLane(handle.container)
              await executeOrThrow(
                planFork({
                  point,
                  paths: disk,
                  spec: setup.specOf(lane, r),
                  env: process.env,
                  install:
                    point.start.kind === "copy"
                      ? await installIfLockMoved(base)
                      : null,
                }),
                handle.runners,
              )
              await handle.start()
              // A copy of your `@` is a commit you have: an offer starts
              // above it, never handing your own edits back (ADR-0038).
              if (point.start.kind === "copy") {
                const copy = await bookmarkOf(registry.laneJjOf(lane), lane)
                if (copy !== null)
                  await writeCopy(deps.agent(), lane, copy, basics.now())
              }
              if (point.snapshot === BASE_SNAPSHOT) setup.refreshBaseSoon()
            },
            { fatal: true },
          )
          .catch(failed(basics, "forking", lane)),
      )
    },
  }
}
