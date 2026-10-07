// host/work/setup — what the host finds for lanes at startup, fixed after it:
// the project, the lane configs and shared directories, the images, runtime
// and grants, and the base snapshot every fork of your `@-` starts from.

import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import {
  errorText,
  type LaneName,
  PRODUCT_NAME,
  type ProjectRecord,
} from "@pinetrie/core"
import { createKeeper, type Keeper } from "@pinetrie/keeper"
import {
  BASE_LANE,
  checkImage,
  commitsOf,
  configJson,
  DEFAULT_REPO,
  type DiskPaths,
  decodeLaneConfig,
  ensureRuntime,
  gatherLinks,
  imagePath,
  jjIn,
  type LaneSpec,
  laneContainer,
  type Mount,
  NO_GRANTS,
  normalShared,
  PINETRIE_INSTALL,
  pinetrieDir,
  planHostMounts,
  planLinks,
  planMounts,
  prepareHost,
  prepareImages,
  prepareShared,
  projectContainerfile,
  readConfigFile,
  refreshBase,
  repoConfig,
  revsetName,
} from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { type RepoOwner, startRepoOwner } from "@pinetrie/repo"
import { type Basics, failed, slow } from "../basics.ts"
import { brokenConfigLine } from "../startup-lines.ts"
import { lockHashAt } from "./disk.ts"
import { openLink } from "./registry.ts"

/** A running lane's memory ceiling. A VM holds only what its guest touched (S39 item 7). */
const LANE_MEMORY = "4G"

/**
 * The `@playwright/test` this app resolves, whose browser the default lane
 * image carries (ADR-0041). A dev dependency: the host runs from pinetrie's
 * repo, where `pnpm install` installs it.
 */
const playwrightVersion = (): string =>
  (
    createRequire(import.meta.url)("@playwright/test/package.json") as {
      version: string
    }
  ).version

/** What lanes of their own need, once the images, runtime and grants are ready. */
export interface Ready {
  readonly image: string
  readonly imagePath: string
  /** pinetrie's default image: the runtime's source, and what trims disks. */
  readonly tools: string
  readonly runtime: string
  readonly links: readonly Mount[]
  readonly identity: { readonly name: string; readonly email: string }
}

/** The lane configs and shared directories (ADR-0035), read at startup. */
export type PreparedLanes = Awaited<ReturnType<typeof prepareLanes>>

export interface Setup {
  /** What the host found where it runs; null when it has no tools. */
  readonly project: ProjectRecord | null
  /** The project root when lanes have their own copies, else null. */
  readonly root: string | null
  /** The one writer of your repo (ADR-0065); null when lanes have no copies here. */
  readonly owner: RepoOwner | null
  readonly paths: DiskPaths | null
  readonly lanes: PreparedLanes | null
  /**
   * Whether lanes run pinetrie's default image, with its browser (ADR-0041) and
   * python3 (ADR-0064): the project has no `pinetrie.Containerfile`.
   */
  readonly defaultImage: boolean
  /** The images, runtime and grants; null when lanes have no copies here. */
  readonly ready: Promise<Ready> | null
  /**
   * The host paths every lane of its own is granted, read-only: the roots of
   * the commands pi loaded (ADR-0036). None when lanes have no copies here.
   */
  readonly hostPaths: readonly string[]
  /** A lane's spec. The base lane gets no shared directories and no host paths. */
  specOf(lane: LaneName, ready: Ready, base?: boolean): LaneSpec
  /** Refresh the base snapshot after the refreshes queued before, in the background. */
  refreshBaseSoon(): void
  /**
   * The base snapshot at accepted work's commit now, after the refreshes queued
   * before: a fork from it waits for this, since accepted work may have been set
   * up or moved since the last refresh (ADR-0060).
   */
  baseAtAccepted(): Promise<void>
}

/** What the host found where it runs: the project, and the disks' paths when lanes have their own. */
export interface Found {
  readonly project: ProjectRecord
  readonly paths: DiskPaths | null
}

/**
 * The project as the host keeps it. `PINETRIE_LANES=0` (`defaultDirect`)
 * changes a new root lane's default, never whether a lane may have its own
 * copy. Pure.
 */
export function projectOf(
  found: Pick<Found, "project"> | null,
  defaultDirect: boolean,
): ProjectRecord | null {
  if (found === null) return null
  const { project } = found
  return project.kind === "lanes" && defaultDirect
    ? { ...project, rootDefault: "direct" }
    : project
}

/**
 * Find the project in `dir`, and whether its lanes can have their own copies:
 * `prepareHost` asks `container`, unless containers are off. Null with no
 * tools (`dir` null). Read before pi's setup, which loads from its root.
 */
export async function findProject(input: {
  /** The project's folder, whose root `prepareHost` finds; null with no tools. */
  readonly dir: string | null
  /** `PINETRIE_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and `container` is not asked. */
  readonly containers: boolean
}): Promise<Found | null> {
  if (input.dir === null) return null
  const found: Found = input.containers
    ? await prepareHost(input.dir)
    : {
        project: {
          kind: "direct",
          root: input.dir,
          reason: "lanes of their own are off for this host",
        },
        paths: null,
      }
  const project = projectOf(found, input.defaultDirect)
  return project === null ? null : { ...found, project }
}

export async function startSetup(input: {
  readonly basics: Basics
  /** What `findProject` found; null with no tools. */
  readonly found: Found | null
  /** The user's config, as read at startup (ADR-0035): its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  /** The commands pi loaded, whose roots lanes are granted (ADR-0036). */
  readonly setup: Pick<PiSetup, "commands" | "agentDir">
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
}): Promise<Setup> {
  const { basics, keeper, found } = input
  const { log } = basics
  const project = found?.project ?? null
  const paths: DiskPaths | null = found?.paths ?? null
  const root = project?.kind === "lanes" ? project.root : null
  if (project !== null) {
    if (project.kind === "lanes")
      log(
        `[host] each thread's agent works in its own container, on a disk cloned from its fork point; your working copy is /mnt/host-working-copy there, read-only${project.rootDefault === "direct" ? " (new threads work directly here by default)" : ""}`,
      )
    else log(`[host] lanes work directly in ${project.root}: ${project.reason}`)
  }

  // Before the rest, since a run's prompt names the shared directories.
  const lanes =
    root === null ? null : await prepareLanes(root, input.userConfig, log)
  // Made here, from the project root and accepted work's names, before anything
  // else reads your repo: the reads below, lane work's and the offers'.
  const owner =
    root === null
      ? null
      : startRepoOwner({
          root,
          repoConfig: lanes?.repoConfig ?? DEFAULT_REPO,
          onError: failed(basics, "your repo"),
          onSlow: slow(basics, "your repo"),
        })
  // Read at startup, as `prepareImages` reads it, so a lane's prompt says
  // what its image has before the images are ready.
  const defaultImage =
    root !== null &&
    (await stat(projectContainerfile(root)).then(
      () => false,
      () => true,
    ))

  const hostMounts =
    root === null
      ? null
      : planHostMounts({
          roots: input.setup.commands().map(c => c.root),
          home: homedir(),
          agentDir: input.setup.agentDir(),
        })
  for (const r of hostMounts?.refused ?? [])
    log(`[host] ${r.path} is not readable in lanes: ${r.reason}`)
  const hostPaths = hostMounts?.mounts ?? []

  const specOf = (lane: LaneName, r: Ready, base = false): LaneSpec => {
    if (root === null)
      throw new Error("lanes of their own are off for this host")
    const grants = lanes?.config.grants ?? NO_GRANTS
    return {
      lane,
      volume: laneContainer(lane),
      image: r.image,
      imagePath: r.imagePath,
      mounts: planMounts({
        hostWorkingCopy: root,
        pinetrie: PINETRIE_INSTALL,
        runtime: r.runtime,
        ignoreDir: pinetrieDir(root).laneGit,
        links: r.links,
        grants: grants.mounts,
        shared: base ? [] : (lanes?.shared ?? []),
        hostPaths: base ? [] : hostPaths,
      }),
      grants: { ssh: grants.ssh, env: grants.env },
      identity: r.identity,
      memory: LANE_MEMORY,
    }
  }

  /**
   * The base snapshot at accepted work's commit (ADR-0060): every lane starts
   * from accepted work, or from a WIP's copy on it. Nothing to do before accepted work
   * is set up.
   */
  async function refreshBaseNow(disk: DiskPaths, r: Ready) {
    if (owner === null) return
    const acceptedBookmark = revsetName(
      (lanes?.repoConfig ?? DEFAULT_REPO).acceptedBookmark,
    )
    const install = lanes?.config.install ?? null
    const read = await owner.read(async ({ jj }) => {
      const yours = await commitsOf(jj, `present(${acceptedBookmark})`)
      const [commit] = yours
      if (commit === undefined) return null
      const lock =
        install === null ? null : await lockHashAt(jj, commit, install.lockfile)
      return { yours, commit, lock }
    })
    if (read === null) return
    const { yours, commit, lock } = read
    const made = await refreshBase({
      paths: disk,
      // Nothing in the base should see a shared directory.
      spec: specOf(BASE_LANE, r, true),
      env: process.env,
      yours,
      lock,
      install,
      open: openLink,
    })
    if (made)
      log(
        `[host] the base snapshot is at accepted work (${commit.slice(0, 8)})`,
      )
  }

  // --- the images, runtime and base snapshot, in the background ----------
  const ready: Promise<Ready> | null =
    root === null || paths === null
      ? null
      : keeper.track(prepare(root, paths, refreshBaseNow, log))
  ready?.catch(error =>
    log(`[host] lanes of their own cannot start: ${errorText(error)}`),
  )

  /** The base snapshot's refreshes, one at a time. */
  const base = createKeeper()
  async function baseAtAccepted(): Promise<void> {
    if (ready === null || paths === null) return
    const disk = paths
    await base.run(async () => refreshBaseNow(disk, await ready))
  }
  function refreshBaseSoon(): void {
    void keeper.track(
      baseAtAccepted().catch(failed(basics, "refreshing the base snapshot")),
    )
  }

  return {
    project,
    root,
    owner,
    paths,
    lanes,
    defaultImage,
    ready,
    hostPaths,
    specOf,
    refreshBaseSoon,
    baseAtAccepted,
  }
}

async function prepareLanes(
  at: string,
  userConfig: { readonly file: string; readonly json: unknown },
  log: (m: string) => void,
) {
  const pnpmLock = await stat(path.join(at, "pnpm-lock.yaml")).then(
    () => true,
    () => false,
  )
  // A missing pinetrie.json is the usual case, and goes unsaid.
  const read = await readConfigFile(path.join(at, "pinetrie.json"))
  if (read.kind === "broken")
    log(brokenConfigLine("pinetrie.json", read.reason))
  const config = decodeLaneConfig(configJson(read), at, pnpmLock)
  const user = decodeLaneConfig(userConfig.json, at, false)
  const { grants } = config
  const on = [
    grants.ssh ? "your ssh agent" : null,
    ...grants.env.map(e => `$${e}`),
    ...grants.mounts.map(m => m.source),
  ].filter(g => g !== null)
  if (on.length > 0) log(`[host] lanes are granted: ${on.join(", ")}`)
  const sharing = await prepareShared(at, {
    user: user.shared,
    project: config.shared,
  })
  for (const d of sharing.shared) {
    const from = user.shared.some(p => normalShared(p) === d.path)
      ? userConfig.file
      : "pinetrie.json"
    log(`[host] ${d.path}/ is shared read-write with every lane (${from})`)
  }
  for (const r of sharing.refused)
    log(`[host] ${r.path} is not shared: ${r.reason}`)
  const { repoConfig: names, refused } = repoConfig(user.offers, config.offers)
  for (const r of refused) log(`[host] ${r}`)
  return { config, repoConfig: names, ...sharing }
}

/** The images, the lane runtime, links and identity; then the base snapshot. */
async function prepare(
  at: string,
  disk: DiskPaths,
  refreshBaseNow: (disk: DiskPaths, r: Ready) => Promise<void>,
  log: (m: string) => void,
): Promise<Ready> {
  const images = await prepareImages(at, playwrightVersion(), log)
  const refused = await checkImage(images.lane)
  if (refused !== null) throw new Error(refused)
  const runtime = await ensureRuntime(
    pinetrieDir(at).runtime,
    images.runtimeFrom,
  )
  // Your jj config, not your repo: asked from its root, as startup asks.
  const config = async (key: string, fallback: string) => {
    const ran = await jjIn(at, ["config", "get", key])
    return ran.ok && ran.stdout.trim() !== "" ? ran.stdout.trim() : fallback
  }
  const result: Ready = {
    image: images.lane,
    imagePath: await imagePath(images.lane),
    tools: images.runtimeFrom,
    runtime,
    links: planLinks(at, await gatherLinks(at)),
    identity: {
      name: await config("user.name", `${PRODUCT_NAME} agent`),
      email: await config("user.email", "agent@pinetrie.invalid"),
    },
  }
  await refreshBaseNow(disk, result)
  log("[host] lanes of their own are ready")
  return result
}
