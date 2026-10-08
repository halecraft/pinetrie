// lanes/base — the base snapshot: the project's disk at the acceptance
// line's commit (ADR-0034, ADR-0104).
//
// Root lanes fork from it as other lanes fork from a turn's snapshot. It is
// accepted work's commit, fetched by id, and its dependencies installed in Linux:
// the only install; no lane ever installs. It is made and refreshed in a
// scratch lane, then snapshotted as `BASE_SNAPSHOT` as a turn is, so a fork
// never reads it half-written. `base.json`, in the project's
// `.pinetrie/snapshots/` on the host, says what it holds.
//
// Also a lane's base as its history names it (`laneBase`), read the same way
// from the lane's own repo and from yours.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  BASE_SNAPSHOT,
  type CommitId,
  commitId,
  type LaneBase,
} from "@pinetrie/core"
import { executeOrThrow } from "./execute.ts"
import { laneHandle, type OpenLink, removeLane } from "./lane.ts"
import { newestBase } from "./merge.ts"
import {
  BASE_LANE,
  type BaseFacts,
  type Install,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  pinetrieDir,
  planBaseRefresh,
  planDisk,
  planSnapshot,
  type RepoConfig,
  revsetName,
} from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import type { Runner } from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"

const factsFile = (root: string) =>
  path.join(pinetrieDir(root).snapshots, `${BASE_SNAPSHOT}.json`)

/** What the base snapshot holds, or null when there is none. */
async function readBase(
  runtime: LaneRuntime,
  root: string,
): Promise<BaseFacts | null> {
  if (!(await runtime.snapshotExists(BASE_SNAPSHOT))) return null
  try {
    const raw = JSON.parse(await readFile(factsFile(root), "utf8")) as {
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
 * current. `spec` is the scratch lane's; its lane is replaced.
 */
export async function refreshBase<C>(input: {
  readonly runtime: LaneRuntime
  /** The project's root, whose `.pinetrie/snapshots/` holds `base.json`. */
  readonly root: string
  readonly spec: LaneSpec<LaneOwner>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly yours: readonly CommitId[]
  /** The lockfile's hash at `yours`; null with no install. */
  readonly lock: string | null
  readonly install: Install | null
  readonly open: OpenLink<C>
}): Promise<boolean> {
  const { runtime, root } = input
  const base = await readBase(runtime, root)
  const steps = planBaseRefresh({
    base,
    yours: input.yours,
    lock: input.lock,
    install: input.install,
  })
  if (steps.length === 0) return false
  await removeLane(runtime, BASE_LANE)
  const handle = laneHandle(runtime, laneContainer(BASE_LANE), input.open)
  try {
    await executeOrThrow(
      [
        ...planDisk({
          spec: { ...input.spec, lane: BASE_LANE },
          env: input.env,
          from: base === null ? null : BASE_SNAPSHOT,
        }),
        ...steps,
        ...planSnapshot({ lane: BASE_LANE, snapshot: BASE_SNAPSHOT }),
      ],
      handle.runners,
    )
    const facts: BaseFacts = { commits: input.yours, lock: input.lock }
    // Its directory is no runtime's to make: Docker keeps snapshots apart.
    await mkdir(path.dirname(factsFile(root)), { recursive: true })
    await writeFile(factsFile(root), `${JSON.stringify(facts)}\n`)
    return true
  } finally {
    await handle.stop().catch(() => {})
    await removeLane(runtime, BASE_LANE)
  }
}

/**
 * A lane's base, from the newest `Pinetrie-Base` in the history of `tip`, a
 * revset: the lane's tip in your repo, or its bookmark in its own repo. A
 * lane with none (one from before accepted work) is on accepted work, from the newest
 * accepted commit in its history; null when there is none. In the lane's own
 * repo such a lane is always null: that repo has no line bookmark.
 */
export async function laneBase(
  jj: Runner,
  tip: string,
  repoConfig: RepoConfig,
): Promise<LaneBase | null> {
  const newest = await newestBase(jj, tip, repoConfig.wipPrefix)
  if (newest === null) {
    const [start] = await commitsOf(
      jj,
      `latest(heads(::(${tip}) & ::present(${revsetName(repoConfig.acceptedBookmark)})))`,
    )
    return start === undefined
      ? null
      : { base: { kind: "accepted" }, start, source: start }
  }
  return newest.kind === "accepted"
    ? {
        base: { kind: "accepted" },
        start: newest.commit,
        source: newest.commit,
      }
    : {
        base: { kind: "wip", bookmark: newest.bookmark },
        start: newest.at,
        source: newest.commit,
      }
}
