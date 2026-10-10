// lanes/base — the base snapshot: accepted work's commits on a dependency
// layer (ADR-0034, ADR-0104, ADR-0131).
//
// Root lanes fork from it as other lanes fork from a turn's snapshot. A
// dependency layer (`deps-<key>`) is a disk on which the project's recipe ran
// once, named by what made it (`depsKey`): built on a fresh disk, with only
// the recipe's caches carried in from the newest layer, so it holds nothing
// an older layer held. The base is a layer restored and accepted work checked
// out on it; no refresh restores an older base. Both are made in a scratch
// lane (`BASE_LANE`), then snapshotted as a turn is, so a fork never reads one
// half-written. The base says what it holds inside itself
// (`.pinetrie-lane/base.json`), and a layer what its recipe made
// (`derived.json`).
//
// Also a lane's base as its history names it (`laneBase`), read the same way
// from the lane's own repo and from yours.

import { createHash } from "node:crypto"
import {
  BASE_SNAPSHOT,
  type CommitId,
  DEPS_PREFIX,
  depsSnapshot,
  type LaneBase,
  type SnapshotId,
  snapshotId,
} from "@pinetrie/core"
import { execute, executeOrThrow, type Runners } from "./execute.ts"
import { laneHandle, type OpenLink, removeLane } from "./lane.ts"
import { newestBase } from "./merge.ts"
import {
  BASE_FILE,
  BASE_LANE,
  type DerivedFacts,
  isBaseCurrent,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  parseBaseFacts,
  planBaseCheckout,
  planBaseFacts,
  planDepsRetention,
  planDisk,
  planRecipe,
  planRecipeRecord,
  planSnapshot,
  type Recipe,
  type RepoConfig,
  revsetName,
} from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import type { Runner } from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"

/**
 * One hash of a recipe's inputs at `rev`, each by its path and content, an
 * input missing there included as missing. Read through `jj` without a
 * snapshot, so it reads your repo's commits and, with a lane's jj, the
 * lane's own.
 */
export async function inputsHash(
  jj: Runner,
  rev: string,
  inputs: readonly string[],
): Promise<string> {
  const hash = createHash("sha256")
  for (const input of [...inputs].sort()) {
    const shown = await jj([
      "file",
      "show",
      "--ignore-working-copy",
      "-r",
      rev,
      `root:${JSON.stringify(input)}`,
    ])
    hash.update(`${input}\0`)
    hash.update(
      shown.ok
        ? createHash("sha256").update(shown.stdout).digest("hex")
        : "missing",
    )
    hash.update("\0")
  }
  return hash.digest("hex")
}

/** The tail of a failed command's output, kept in `derived.json`. */
const tailOf = (out: string): string =>
  out.trim().split("\n").slice(-20).join("\n")

/**
 * Run `recipe` on a running lane's disk, and record what it made: plan,
 * gather the diff, plan again. Its recorded outputs are removed first, and
 * a failed command is recorded, not thrown: its outputs too are removed at
 * the next run. Returns what the disk now records (`derived.json`).
 */
export async function runRecipe(input: {
  readonly runners: Runners
  readonly lane: LaneOwner
  readonly recipe: Recipe
  readonly key: string
  /** The disk's `derived.json` now. */
  readonly outputs: readonly string[]
  readonly previous: string | null
}): Promise<DerivedFacts> {
  const { runners, lane, recipe } = input
  const pre = snapshotId(`recipe-pre-${lane}`)
  const post = snapshotId(`recipe-post-${lane}`)
  const steps = planRecipe({ lane, recipe, outputs: input.outputs, pre, post })
  await executeOrThrow(steps.before, runners)
  const ran = await execute([steps.command], runners)
  await executeOrThrow(steps.after, runners)
  const failed = ran.ok
    ? null
    : tailOf(`${String(ran.ran.stdout)}\n${ran.ran.stderr}`)
  const recorded = planRecipeRecord({
    diff: await runners.runtime.diff(pre, post),
    recipe,
    key: input.key,
    previous: input.previous,
    failed,
    pre,
    post,
  })
  await executeOrThrow(recorded.steps, runners)
  return recorded.facts
}

/** The newest dependency layer, whose caches a new one carries in; null with none. */
async function newestLayer(runtime: LaneRuntime): Promise<SnapshotId | null> {
  const layers = (await runtime.snapshots())
    .filter(s => s.id.startsWith(DEPS_PREFIX))
    .sort((a, b) => b.made - a.made)
  const [newest] = layers
  return newest === undefined ? null : snapshotId(newest.id)
}

/** What building in the scratch lane takes. */
interface Scratch<C> {
  readonly runtime: LaneRuntime
  /** The scratch lane's spec; its lane is replaced. */
  readonly spec: LaneSpec<LaneOwner>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly open: OpenLink<C>
}

/** `work` in the scratch lane, made anew, removed after whatever happens. */
async function inScratch<C, T>(
  scratch: Scratch<C>,
  disk: {
    readonly from: SnapshotId | null
    readonly carry: { from: SnapshotId; paths: readonly string[] } | null
  },
  work: (runners: Runners) => Promise<T>,
): Promise<T> {
  const { runtime } = scratch
  await removeLane(runtime, BASE_LANE)
  const handle = laneHandle(runtime, laneContainer(BASE_LANE), scratch.open)
  try {
    await executeOrThrow(
      planDisk({
        spec: { ...scratch.spec, lane: BASE_LANE },
        env: scratch.env,
        from: disk.from,
        carry: disk.carry,
      }),
      handle.runners,
    )
    return await work(handle.runners)
  } finally {
    await handle.stop().catch(() => {})
    await removeLane(runtime, BASE_LANE)
  }
}

/**
 * The dependency layer `key` names, at `commits`: made if missing, on a
 * fresh disk carrying only the recipe's caches from the newest layer, then
 * the recipe run on it; with no recipe, the checkout alone. A failed recipe
 * throws, and no layer is made.
 */
export async function ensureDepsLayer<C>(
  input: Scratch<C> & {
    readonly commits: readonly CommitId[]
    readonly recipe: Recipe | null
    readonly key: string
  },
): Promise<SnapshotId> {
  const { recipe } = input
  const layer = depsSnapshot(input.key)
  if (await input.runtime.snapshotExists(layer)) return layer
  const newest = await newestLayer(input.runtime)
  const caches = recipe?.caches ?? []
  await inScratch(
    input,
    {
      from: null,
      carry:
        newest === null || caches.length === 0
          ? null
          : { from: newest, paths: caches },
    },
    async runners => {
      await executeOrThrow(
        planBaseCheckout({ yours: input.commits, fresh: true }),
        runners,
      )
      if (recipe !== null) {
        const made = await runRecipe({
          runners,
          lane: BASE_LANE,
          recipe,
          key: input.key,
          outputs: [],
          previous: null,
        })
        if (made.failed !== null)
          throw new Error(
            `the recipe failed: ${made.failed.split("\n").at(-1) ?? ""}`,
          )
      }
      await executeOrThrow(
        planSnapshot({ lane: BASE_LANE, snapshot: layer }),
        runners,
      )
    },
  )
  return layer
}

/**
 * Make the base snapshot at `yours` on the dependency layer `key` names:
 * the layer restored (made first if missing) and `yours` checked out on it.
 * Never an older base. Does nothing when the base already holds them. Old
 * layers go after (`planDepsRetention`).
 */
export async function refreshBase<C>(
  input: Scratch<C> & {
    readonly yours: readonly CommitId[]
    readonly recipe: Recipe | null
    /** `depsKey` at `yours`. */
    readonly key: string
  },
): Promise<boolean> {
  const { runtime, yours, key } = input
  const base = parseBaseFacts(
    await runtime.readLaneFile(BASE_SNAPSHOT, BASE_FILE),
  )
  if (isBaseCurrent(base, yours, key)) return false
  const layer = await ensureDepsLayer({ ...input, commits: yours })
  await inScratch(input, { from: layer, carry: null }, async runners => {
    await executeOrThrow(
      [
        ...planBaseCheckout({ yours, fresh: false }),
        planBaseFacts({ commits: yours, key }),
        ...planSnapshot({ lane: BASE_LANE, snapshot: BASE_SNAPSHOT }),
      ],
      runners,
    )
  })
  await runtime.disk({
    kind: "deleteSnapshots",
    ids: planDepsRetention({
      snapshots: await runtime.snapshots(),
      keep: [key],
    }),
  })
  return true
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
