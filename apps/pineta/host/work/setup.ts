// host/work/setup — what the host finds for lanes at startup, fixed after it:
// the project, the lane configs and shared directories, the images, runtime
// and grants, and the base snapshot every fork of your `@-` starts from.

import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import type { LaneName, ProjectRecord } from "@pineta/core"
import {
  BASE_LANE,
  checkImage,
  type DiskPaths,
  decodeLaneConfig,
  ensureRuntime,
  gatherLinks,
  hostJj,
  imagePath,
  type LaneSpec,
  laneContainer,
  laneIgnoreDir,
  type Mount,
  NO_GRANTS,
  normalShared,
  PINETA_INSTALL,
  planHostMounts,
  planLinks,
  planMounts,
  prepareHost,
  prepareImages,
  prepareShared,
  projectContainerfile,
  readLaneConfig,
  refreshBase,
  yoursNow,
} from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import { type Basics, failed, messageOf } from "../basics.ts"
import { createSerial, type Serial } from "../queue.ts"
import { lockHashAt } from "./disk.ts"
import { openLink } from "./registry.ts"

/** A running lane's memory ceiling. A VM holds only what its guest touched (S39 item 7). */
const LANE_MEMORY = "4G"

/**
 * The `@playwright/test` this app resolves, whose browser the default lane
 * image carries (ADR-0041). A dev dependency: the host runs from Pineta's
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
  /** Pineta's default image: the runtime's source, and what trims disks. */
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
  readonly paths: DiskPaths | null
  readonly lanes: PreparedLanes | null
  /** Whether a lane's image has Pineta's browser (ADR-0041). */
  readonly browser: boolean
  /** The images, runtime and grants; null when lanes have no copies here. */
  readonly ready: Promise<Ready> | null
  /**
   * The host paths every lane of its own is granted, read-only: the roots of
   * the commands pi loaded (ADR-0036). Read on first use, once the agent
   * exists, which is before any lane's spec or access is asked for.
   */
  hostPaths(): readonly string[]
  /** A lane's spec. The base lane gets no shared directories and no host paths. */
  specOf(lane: LaneName, ready: Ready, base?: boolean): LaneSpec
  /** Refresh the base snapshot after the refreshes queued before, in the background. */
  refreshBaseSoon(): void
}

export async function startSetup(input: {
  readonly basics: Basics
  /** The directory the host runs from, or null with no tools. */
  readonly dir: string | null
  /** `PINETA_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and `container` is not asked. */
  readonly containers: boolean
  /** The user's config, as read at startup (ADR-0035): its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  readonly agent: () => Agent
  /** Work nobody awaits: `quiet` waits for it. */
  readonly serial: Serial
}): Promise<Setup> {
  const { basics, serial } = input
  const { log } = basics
  const found =
    input.dir === null
      ? null
      : input.containers
        ? await prepareHost(input.dir)
        : {
            project: {
              kind: "direct" as const,
              root: input.dir,
              reason: "lanes of their own are off for this host",
            },
            paths: null,
          }
  // `PINETA_LANES=0` changes a new root lane's default, never whether a lane
  // may have its own copy.
  const project: ProjectRecord | null =
    found === null
      ? null
      : found.project.kind === "lanes" && input.defaultDirect
        ? { ...found.project, rootDefault: "direct" }
        : found.project
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
  // Read at startup, as `prepareImages` reads it, so a lane's prompt says
  // whether its image has a browser before the images are ready.
  const browser =
    root !== null &&
    (await stat(projectContainerfile(root)).then(
      () => false,
      () => true,
    ))

  let hostMounts: ReturnType<typeof planHostMounts> | null = null
  const hostPaths = (): readonly string[] => {
    if (hostMounts === null) {
      const agent = input.agent()
      hostMounts = planHostMounts({
        roots: agent.commands().map(c => c.root),
        home: homedir(),
        agentDir: agent.agentDir(),
      })
      for (const r of hostMounts.refused)
        log(`[host] ${r.path} is not readable in lanes: ${r.reason}`)
    }
    return hostMounts.mounts
  }

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
        pineta: PINETA_INSTALL,
        runtime: r.runtime,
        ignoreDir: laneIgnoreDir(root),
        links: r.links,
        grants: grants.mounts,
        shared: base ? [] : (lanes?.shared ?? []),
        hostPaths: base ? [] : hostPaths(),
      }),
      grants: { ssh: grants.ssh, env: grants.env },
      identity: r.identity,
      memory: LANE_MEMORY,
    }
  }

  async function refreshBaseNow(at: string, disk: DiskPaths, r: Ready) {
    const jj = hostJj(at)
    const yours = await yoursNow(jj)
    const install = lanes?.config.install ?? null
    const lock =
      install === null ? null : await lockHashAt(jj, "@-", install.lockfile)
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
        `[host] the base snapshot is at your @- (${yours.map(c => c.slice(0, 8)).join(", ")})`,
      )
  }

  // --- the images, runtime and base snapshot, in the background ----------
  const ready: Promise<Ready> | null =
    root === null || paths === null
      ? null
      : serial.track(prepare(root, paths, refreshBaseNow, log))
  ready?.catch(error =>
    log(`[host] lanes of their own cannot start: ${messageOf(error)}`),
  )

  /** The base snapshot's refreshes, one at a time. */
  const base = createSerial()
  function refreshBaseSoon(): void {
    if (ready === null || root === null || paths === null) return
    const [at, disk] = [root, paths]
    void serial.track(
      base
        .run(async () => refreshBaseNow(at, disk, await ready))
        .catch(failed(basics, "refreshing the base snapshot")),
    )
  }

  return {
    project,
    root,
    paths,
    lanes,
    browser,
    ready,
    hostPaths,
    specOf,
    refreshBaseSoon,
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
  const config = await readLaneConfig(
    path.join(at, "pineta.json"),
    at,
    pnpmLock,
  )
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
      : "pineta.json"
    log(`[host] ${d.path}/ is shared read-write with every lane (${from})`)
  }
  for (const r of sharing.refused)
    log(`[host] ${r.path} is not shared: ${r.reason}`)
  return { config, ...sharing }
}

/** The images, the lane runtime, links and identity; then the base snapshot. */
async function prepare(
  at: string,
  disk: DiskPaths,
  refreshBaseNow: (at: string, disk: DiskPaths, r: Ready) => Promise<void>,
  log: (m: string) => void,
): Promise<Ready> {
  const images = await prepareImages(at, playwrightVersion(), log)
  const refused = await checkImage(images.lane)
  if (refused !== null) throw new Error(refused)
  const runtime = await ensureRuntime(
    path.join(at, ".pineta", "runtime"),
    images.runtimeFrom,
  )
  const jj = hostJj(at)
  const config = async (key: string, fallback: string) => {
    const ran = await jj(["config", "get", key])
    return ran.ok && ran.stdout.trim() !== "" ? ran.stdout.trim() : fallback
  }
  const result: Ready = {
    image: images.lane,
    imagePath: await imagePath(images.lane),
    tools: images.runtimeFrom,
    runtime,
    links: planLinks(at, await gatherLinks(at)),
    identity: {
      name: await config("user.name", "Pineta agent"),
      email: await config("user.email", "agent@pineta.invalid"),
    },
  }
  await refreshBaseNow(at, disk, result)
  log("[host] lanes of their own are ready")
  return result
}
