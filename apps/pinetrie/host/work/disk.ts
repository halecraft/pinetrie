// host/work/disk — what a turn wrote, classed: its runs drained, the
// paths they name checked against `.gitignore` in the lane, the new recipes'
// inputs hashed, and the registry written, all before the turn's snapshot,
// so the snapshot holds the registry its outputs are kept by. After the
// snapshot, in the same queued step (the container stops after a run), its
// diff adds what no tool call wrote. At every container start and after an
// update's merge, the outputs whose recipe's key no longer holds go
// (`removeStaleOutputs`).

import {
  type DiskDiff,
  type LaneRuns,
  type Registry,
  type SharedAccess,
  type TurnDisk,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  LANE_CONFIG_DIR,
  type LaneHandle,
  REGISTRY_FILE,
} from "@pinetrie/lanes"
import { drainLaneRuns, type LaneChannel, supervisorSource } from "@pinetrie/pi"
import {
  type ClassedWrites,
  decodeRegistry,
  planStaleOutputs,
  registryAfter,
  turnDisk,
  unattributed,
  writesToClass,
} from "@pinetrie/rules"

const REGISTRY = `${LANE_CONFIG_DIR}/${REGISTRY_FILE}`

/**
 * Of `paths`, those the lane's `.gitignore` files and its ignore file
 * ignore. On `--stdin`: a turn can name more paths than a command line
 * holds.
 */
async function checkIgnored(
  channel: LaneChannel,
  paths: readonly string[],
): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return new Set()
  const ran = await channel.run(
    ["git", "check-ignore", "--no-index", "-z", "--stdin"],
    false,
    undefined,
    `${paths.join("\0")}\0`,
  )
  // 1: none is ignored.
  if (ran.code !== 0 && ran.code !== 1)
    throw new Error(`git check-ignore failed: ${ran.stderr}`)
  return new Set(
    String(ran.stdout)
      .split("\0")
      .filter(p => p !== ""),
  )
}

/** The disk's registry; an empty one when it has none, or one that does not decode. */
async function readRegistry(channel: LaneChannel): Promise<Registry> {
  const read = await channel.run(["cat", REGISTRY], false)
  return decodeRegistry(read.code === 0 ? String(read.stdout) : null)
}

/** Written through stdin: one shell argument is capped at 128 KB. */
async function writeRegistry(
  channel: LaneChannel,
  registry: Registry,
): Promise<void> {
  const wrote = await channel.run(
    ["sh", "-c", `mkdir -p ${LANE_CONFIG_DIR} && cat > ${REGISTRY}`],
    false,
    undefined,
    JSON.stringify(registry),
  )
  if (wrote.code !== 0)
    throw new Error(`writing the registry failed: ${wrote.stderr}`)
}

/**
 * On the lane's queue, at a container's start and after an update's merge:
 * each derived output whose recipe's key no longer holds deleted, caches
 * kept, and the registry rewritten.
 */
export async function removeStaleOutputs(
  handle: LaneHandle<LaneChannel>,
  image: string,
): Promise<void> {
  const { channel } = await handle.link()
  const registry = await readRegistry(channel)
  if (registry.recipes.length === 0) return
  const planned = planStaleOutputs({
    registry,
    checks: await channel.checkRecipes(registry.recipes),
    image,
  })
  if (planned.remove.length > 0) {
    const removed = await channel.run(
      ["rm", "-rf", "--", ...planned.remove.map(p => `${WORKSPACE_ROOT}/${p}`)],
      false,
    )
    if (removed.code !== 0)
      throw new Error(`removing stale outputs failed: ${removed.stderr}`)
  }
  if (planned.registry.recipes.length < registry.recipes.length)
    await writeRegistry(channel, planned.registry)
}

/**
 * On the lane's queue, before its snapshot: the turn's runs and tool
 * writes classed, and the registry they leave written to the disk.
 */
export async function classifyWritesOnQueue(input: {
  readonly handle: LaneHandle<LaneChannel>
  /** Paths the turn's commit changed. */
  readonly changed: readonly string[]
  /** Shared directories, from the disk's root. */
  readonly shared: readonly string[]
  /** The lane's image, by its tag. */
  readonly image: string
}): Promise<{
  readonly writes: ClassedWrites
  /** What its runs and tools did to shared files, as accessed. */
  readonly touched: readonly SharedAccess[]
}> {
  const { handle, shared } = input
  const { channel } = await handle.link()
  const drained = await drainLaneRuns(channel, supervisorSource(channel))
  const touched = sharedAccesses(drained)
  const registry = await readRegistry(channel)
  const toClass = writesToClass({
    runs: drained.runs,
    toolWrites: drained.toolWrites,
    registry,
    shared,
    changed: input.changed,
  })
  const writes = toClass.classify(await checkIgnored(channel, toClass.paths))
  if (
    writes.made.length === 0 &&
    writes.roots.size === 0 &&
    writes.gone.length === 0
  )
    return { writes, touched }
  const toKey = registryAfter({ registry, writes, image: input.image })
  const next = toKey.next(await channel.hashes(toKey.paths))
  await writeRegistry(channel, next)
  return { writes, touched }
}

/**
 * A turn's accesses of shared files: its runs', and the write tools' and
 * read tools', in the lane's monotonic order (`sharedTouches` sorts them).
 */
const sharedAccesses = (drained: LaneRuns): readonly SharedAccess[] => [
  ...drained.runs.flatMap(r => r.shared),
  ...drained.toolShared,
]

/**
 * On the lane's queue, after the snapshot, while the container still runs:
 * the turn's record of its disk, with its diff's unattributed paths.
 */
export async function diskOfTurn(input: {
  readonly handle: LaneHandle<LaneChannel>
  readonly writes: ClassedWrites
  readonly diff: DiskDiff | null
  readonly shared: readonly string[]
}): Promise<TurnDisk> {
  const rest =
    input.diff === null
      ? []
      : unattributed(input.writes, input.diff, input.shared)
  const { channel } = await input.handle.link()
  const ignored = await checkIgnored(channel, rest)
  return turnDisk(
    input.writes,
    rest.filter(p => ignored.has(p)),
  )
}
