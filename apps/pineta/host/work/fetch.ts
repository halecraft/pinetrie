// host/work/fetch — a lane's history into your repo (ADR-0038): bundled in
// the lane, fetched on the host as its remote bookmark, then its offer
// follows.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { CommitId, LaneName } from "@pineta/core"
import {
  bookmarkOf,
  commitsOf,
  containerFacts,
  executeOrThrow,
  hostGit,
  planFetch,
  stackBookmark,
} from "@pineta/lanes"
import { type Basics, failed } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import { createSerial, type Serial } from "../queue.ts"
import type { Containers } from "./containers.ts"
import type { LaneRegistry } from "./registry.ts"

export interface Fetches {
  /**
   * Fetch the lane's bookmark into your repo, as its remote bookmark, or with
   * `stack` a split's stack. The bundle is made on the lane's queue, since it
   * needs the lane running: about 30 ms (S43 item 8), and a container stopped
   * since is started for it, then stopped. Your repo fetches it on the lane's
   * fetch queue, which tools never wait on; then the lane's offer follows.
   */
  fetchLane(
    lane: LaneName,
    have: readonly (CommitId | null)[],
    stack?: boolean,
  ): Promise<void>
}

export function createFetches(deps: {
  readonly basics: Basics
  /** The project root when lanes have their own copies, else null. */
  readonly root: string | null
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly serial: Serial
  readonly offers: Offers | null
  readonly startContainer: Containers["startContainer"]
}): Fetches {
  const { basics, root, registry, serial, offers } = deps
  /** Each lane's fetches into your repo, one at a time. */
  const queues = new Map<LaneName, Serial>()
  const queueOf = (lane: LaneName): Serial => {
    let queue = queues.get(lane)
    if (queue === undefined) {
      queue = createSerial()
      queues.set(lane, queue)
    }
    return queue
  }

  /** What your repo has of `candidates`: a bundle may exclude only those. */
  async function yoursHas(
    at: string,
    candidates: readonly (CommitId | null)[],
  ): Promise<CommitId[]> {
    const git = hostGit(at)
    const out: CommitId[] = []
    for (const c of candidates)
      if (c !== null && (await git(["cat-file", "-e", `${c}^{commit}`])).ok)
        out.push(c)
    return out
  }

  return {
    fetchLane(lane, have, stack = false) {
      if (root === null) return Promise.resolve()
      const at = root
      const handle = registry.handleOf(lane)
      const bundled = handle.queue.enqueue(async () => {
        const stopped =
          (await containerFacts(handle.container)).state !== "running"
        if (stopped) await deps.startContainer(lane)
        try {
          const jj = registry.laneJjOf(lane)
          const bookmark = stack
            ? await commitsOf(
                jj,
                `present(bookmarks(exact:"${stackBookmark(lane)}"))`,
              ).then(c => c[0] ?? null)
            : await bookmarkOf(jj, lane)
          if (bookmark === null) return null
          const dir = await mkdtemp(path.join(tmpdir(), "pineta-bundle-"))
          const steps = planFetch({
            lane,
            have: await yoursHas(at, have),
            root: at,
            bundle: path.join(dir, "lane.bundle"),
            stack,
          })
          await executeOrThrow(
            steps.filter(s => s.in === "lane"),
            handle.runners,
          )
          return { dir, steps: steps.filter(s => s.in === "host") }
        } finally {
          if (stopped) await handle.stop()
        }
      })
      return serial
        .track(
          queueOf(lane).run(async () => {
            const made = await bundled
            if (made === null) return
            try {
              await executeOrThrow(made.steps, handle.runners)
            } finally {
              await rm(made.dir, { recursive: true, force: true })
            }
            if (!stack) offers?.touch(lane)
          }),
        )
        .catch(failed(basics, "fetching into your repo", lane))
    },
  }
}
