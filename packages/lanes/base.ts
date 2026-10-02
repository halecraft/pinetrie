// lanes/base — the base snapshot: the project's disk at the integration
// line's commit (ADR-0034, ADR-0060).
//
// Root lanes fork from it as other lanes fork from a turn's snapshot. It is
// the line's commit, fetched by id, and its dependencies installed in Linux:
// the only install; no lane ever installs. It is made and refreshed in a
// scratch lane, then snapshotted back as `base.img` as a turn is, so a fork
// never reads it half-written. `base.json` beside it says what it holds.

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  BASE_SNAPSHOT,
  type CommitId,
  commitId,
  laneNameForThread,
} from "@pineta/core"
import { snapshotExists } from "./disk.ts"
import { executeOrThrow } from "./execute.ts"
import { laneHandle, type OpenLink, removeLane } from "./lane.ts"
import {
  type BaseFacts,
  type DiskPaths,
  type Install,
  type LaneSpec,
  laneContainer,
  planBaseRefresh,
  planDisk,
  planSnapshot,
} from "./plan.ts"

/** The scratch lane a base is made in; never a thread's. */
export const BASE_LANE = laneNameForThread("base-scratch")

const factsFile = (paths: DiskPaths) =>
  path.join(paths.snapshots, `${BASE_SNAPSHOT}.json`)

/** What the base snapshot holds, or null when there is none. */
async function readBase(paths: DiskPaths): Promise<BaseFacts | null> {
  if (!(await snapshotExists(paths, BASE_SNAPSHOT))) return null
  try {
    const raw = JSON.parse(await readFile(factsFile(paths), "utf8")) as {
      commits?: unknown
      lock?: unknown
    }
    if (
      !Array.isArray(raw.commits) ||
      !raw.commits.every(c => typeof c === "string")
    )
      return null
    return {
      commits: raw.commits.map(c => commitId(String(c))),
      lock: typeof raw.lock === "string" ? raw.lock : null,
    }
  } catch {
    return null
  }
}

/**
 * Make or refresh the base snapshot at `yours`. Does nothing when it is
 * current. `spec` is the scratch lane's; its lane and volume are replaced.
 */
export async function refreshBase<C>(input: {
  readonly paths: DiskPaths
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
  readonly yours: readonly CommitId[]
  /** The lockfile's hash at `yours`; null with no install. */
  readonly lock: string | null
  readonly install: Install | null
  readonly open: OpenLink<C>
}): Promise<boolean> {
  const { paths } = input
  const base = await readBase(paths)
  const steps = planBaseRefresh({
    base,
    yours: input.yours,
    lock: input.lock,
    install: input.install,
  })
  if (steps.length === 0) return false
  const container = laneContainer(BASE_LANE)
  await removeLane(container)
  const handle = laneHandle(container, input.open)
  try {
    await executeOrThrow(
      [
        ...planDisk({
          paths,
          spec: { ...input.spec, lane: BASE_LANE, volume: container },
          env: input.env,
          from: base === null ? null : BASE_SNAPSHOT,
        }),
        ...steps,
        ...planSnapshot({ volume: container, snapshot: BASE_SNAPSHOT, paths }),
      ],
      handle.runners,
    )
    const facts: BaseFacts = { commits: input.yours, lock: input.lock }
    await writeFile(factsFile(paths), `${JSON.stringify(facts)}\n`)
    return true
  } finally {
    await handle.stop().catch(() => {})
    await removeLane(container)
  }
}
