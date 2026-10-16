// host/jj/fetch — a lane's history into your repo: bundled in the lane, on its
// queue, then imported by the owner of your repo as the lane's remote bookmark.
// The owner observes the import, which marks the lane's proposed changes.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { CommitId, ThreadId } from "@pinetrie/core"
import type { RepoOwner } from "@pinetrie/jj"
import {
  bookmarkName,
  bookmarkOf,
  bookmarkRevset,
  commitsOf,
  laneJj,
  planBundle,
  stackBookmark,
} from "@pinetrie/jj"
import type { Keeper } from "@pinetrie/keeper"
import { executeOrThrow } from "@pinetrie/lanes"
import { type Basics, failed } from "../basics.ts"
import type { ProjectParts } from "../work/adapter.ts"
import type { LaneRegistry } from "../work/registry.ts"

export interface Fetches {
  /**
   * Fetch the lane's bookmark into your repo, as its remote bookmark, or with
   * `stack` a split's stack. The bundle is made on the lane's queue, since it
   * needs the lane running: about 30 ms, and a container stopped since is
   * started for it, then stopped. The owner of your repo imports it as a
   * command, queued as the bundle is made: the lane's queue makes its bundles
   * in order, and the owner runs its commands in the order they arrive, so a
   * lane's imports keep their order. That matters: the fetch forces its ref, so
   * an older bundle imported after a newer one would move it back. Resolves
   * once imported.
   */
  fetchLane(
    lane: ThreadId,
    have: readonly (CommitId | null)[],
    stack?: boolean,
  ): Promise<void>
}

export function createFetches(deps: {
  readonly basics: Basics
  /** The owner of your repo. */
  readonly owner: RepoOwner
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly startContainer: ProjectParts["startContainer"]
}): Fetches {
  const { basics, owner, registry, keeper } = deps

  /** What your repo has of `candidates`: a bundle may exclude only those. */
  const yoursHas = (
    yours: RepoOwner,
    candidates: readonly (CommitId | null)[],
  ): Promise<CommitId[]> =>
    yours.read(async ({ git }) => {
      const out: CommitId[] = []
      for (const c of candidates)
        if (c !== null && (await git(["cat-file", "-e", `${c}^{commit}`])).ok)
          out.push(c)
      return out
    })

  return {
    fetchLane(lane, have, stack = false) {
      const yours = owner
      const bundled = registry.withHistory(lane, async (h, handle) => {
        const stopped =
          (await handle.runners.runtime.containerFacts(handle.container))
            .state !== "running"
        if (stopped) await deps.startContainer(lane, h)
        try {
          const jj = laneJj(handle.runners.lane)
          const name = stack ? stackBookmark(lane) : bookmarkName(lane)
          const bookmark = stack
            ? await commitsOf(jj, `present(${bookmarkRevset(name)})`).then(
                c => c[0] ?? null,
              )
            : await bookmarkOf(jj, lane)
          if (bookmark === null) return null
          const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-bundle-"))
          const bundle = path.join(dir, "lane.bundle")
          await executeOrThrow(
            [
              planBundle({
                bookmark: name,
                have: await yoursHas(yours, have),
                to: bundle,
              }),
            ],
            handle.runners,
          )
          return { dir, bundle }
        } finally {
          if (stopped) await handle.stop()
        }
      })
      return keeper
        .track(
          bundled.then(async made => {
            if (made === null) return
            try {
              await yours.importLane(lane, made.bundle, stack)
            } finally {
              await rm(made.dir, { recursive: true, force: true })
            }
          }),
        )
        .catch(failed(basics, "fetching into your repo", lane))
    },
  }
}
