// host/work/setup — what the host finds for lanes at startup, fixed after it:
// the project, the lane configs and shared directories, the images, runtime
// and grants, and the base snapshot every fork of your `@-` starts from.

import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import {
  errorText,
  isThreadId,
  PRODUCT_NAME,
  PROJECT_CONFIG_FILE,
  type ProjectRecord,
} from "@pinetrie/core"
import { createKeeper, type Keeper } from "@pinetrie/keeper"
import {
  BASE_LANE,
  checkImage,
  commitsOf,
  configJson,
  decodeLaneConfig,
  ensureRuntime,
  gatherLinks,
  jjIn,
  type LaneOwner,
  type LaneRuntime,
  type LaneSpec,
  type Mount,
  PINETRIE_INSTALL,
  pinetrieDir,
  planHostMounts,
  planLinks,
  planMounts,
  prepareImages,
  projectContainerfile,
  RUNTIME_BIN,
  readConfigFile,
  refreshBase,
  repoConfig,
  revsetName,
} from "@pinetrie/lanes"
import { type PiSetup, supervisionEnv } from "@pinetrie/pi"
import { type RepoOwner, renameAccepted, startRepoOwner } from "@pinetrie/repo"
import { type Basics, failed, slow } from "../basics.ts"
import { brokenConfigLine } from "../startup-lines.ts"
import { type LaneConfigs, startLaneConfigs } from "./config.ts"
import { openLinkOf } from "./registry.ts"
import type { Found } from "./runtime.ts"

/** A running lane's memory ceiling. */
const LANE_MEMORY = "4G"

/**
 * The `@playwright/test` this app resolves, whose browser the default lane
 * image carries. A dev dependency: the host runs from pinetrie's repo, where
 * `pnpm install` installs it.
 */
export const playwrightVersion = (): string =>
  (
    createRequire(import.meta.url)("@playwright/test/package.json") as {
      version: string
    }
  ).version

/** What lanes of their own need, once the images, runtime and grants are ready. */
export interface Ready {
  readonly image: string
  readonly imagePath: string
  /** The lane runtime's directory on the host (`ensureRuntime`). */
  readonly runtime: string
  readonly links: readonly Mount[]
  readonly identity: { readonly name: string; readonly email: string }
}

/** Your repo's names and your config's `lanes`, read at startup. */
export type PreparedLanes = Awaited<ReturnType<typeof prepareLanes>>

/**
 * What a host with tools found for its lanes, all of it or none
 * (`startSetup` returns null without tools): a host with tools has a
 * project, a runtime, your repo's owner and the lanes' configs.
 */
export interface Setup {
  /** What the host found where it runs. */
  readonly project: ProjectRecord
  /** The project's root. */
  readonly root: string
  /** The one writer of your repo. */
  readonly owner: RepoOwner
  /** What lanes run on. */
  readonly runtime: LaneRuntime
  readonly lanes: PreparedLanes
  /** Each lane's grants and shared directories, as facts of states. */
  readonly configs: LaneConfigs
  /**
   * Whether lanes run pinetrie's default image, with its browser and python3:
   * the project has no `pinetrie.Containerfile`.
   */
  readonly defaultImage: boolean
  /** The images, runtime and grants, made in the background. */
  readonly ready: Promise<Ready>
  /**
   * The host paths every lane is granted, read-only: the roots of the commands
   * pi loaded.
   */
  readonly hostPaths: readonly string[]
  /**
   * A lane's spec, from the config it runs with (`configs`). The base lane
   * gets accepted work's grants, and no shared directories or host paths.
   */
  specOf<L extends LaneOwner>(
    lane: L,
    ready: Ready,
    base?: boolean,
  ): LaneSpec<L>
  /** Refresh the base snapshot after the refreshes queued before, in the background. */
  refreshBaseSoon(): void
  /**
   * The base snapshot at accepted work's commit now, after the refreshes queued
   * before: a fork from it waits for this, since accepted work may have been
   * set up or moved since the last refresh.
   */
  baseAtAccepted(): Promise<void>
}

export async function startSetup(input: {
  readonly basics: Basics
  /** What `findProject` found; null with no tools. */
  readonly found: Found | null
  /** The user's config, as read at startup: its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  /** The commands pi loaded, whose roots lanes are granted. */
  readonly setup: Pick<PiSetup, "commands" | "agentDir">
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
}): Promise<Setup | null> {
  const { basics, keeper, found } = input
  const { log } = basics
  if (found === null) return null
  const { project, runtime } = found
  const { root } = project
  log(
    "[host] each thread's agent works in its own container, on a disk cloned from its fork point; your working copy is /mnt/host-working-copy there, read-only",
  )

  // Before the rest, since a run's prompt names the shared directories.
  const lanes = await prepareLanes(root, input.userConfig, log)
  // Made here, from the project root and accepted work's names, before anything
  // else reads your repo: the reads below, lane work's and the offers'.
  const owner = startRepoOwner({
    root,
    repoConfig: lanes.repoConfig,
    onError: failed(basics, "your repo"),
    onSlow: slow(basics, "your repo"),
  })
  // pre-accepted: the owner's first command, before its first observation.
  // Delete with `renameAccepted`.
  await owner
    .command(ops => renameAccepted(ops, lanes.repoConfig.acceptedBookmark))
    .then(
      lines => {
        for (const line of lines) log(`[host] ${line}`)
      },
      failed(basics, "renaming accepted work's bookmark"),
    )
  // Before anything mounts a shared directory or grants a lane anything.
  const configs = await startLaneConfigs({
    root,
    owner,
    repoConfig: lanes.repoConfig,
    user: lanes.user,
    userFile: input.userConfig.file,
    log,
  })
  // Read at startup, as `prepareImages` reads it, so a lane's prompt says
  // what its image has before the images are ready.
  const defaultImage = await stat(projectContainerfile(root)).then(
    () => false,
    () => true,
  )

  const hostMounts = planHostMounts({
    roots: input.setup.commands().map(c => c.root),
    home: homedir(),
    agentDir: input.setup.agentDir(),
  })
  for (const r of hostMounts.refused)
    log(`[host] ${r.path} is not readable in lanes: ${r.reason}`)
  const hostPaths = hostMounts.mounts

  const specOf = <L extends LaneOwner>(
    lane: L,
    r: Ready,
    base = false,
  ): LaneSpec<L> => {
    const own = !base && isThreadId(lane) ? lane : null
    const { grants } =
      own === null ? configs.accepted().authority : configs.laneConfig(own)
    return {
      lane,
      image: r.image,
      imagePath: r.imagePath,
      mounts: planMounts({
        hostWorkingCopy: root,
        pinetrie: PINETRIE_INSTALL,
        runtime: r.runtime,
        ignoreDir: pinetrieDir(root).laneGit,
        links: r.links,
        grants: grants.mounts,
        shared: own === null ? [] : configs.laneShared(own),
        hostPaths: base ? [] : hostPaths,
      }),
      grants: {
        ssh: grants.ssh,
        nested: grants.nested,
        hostPorts: grants.hostPorts,
        env: grants.env,
      },
      identity: r.identity,
      memory: LANE_MEMORY,
      observation: supervisionEnv(RUNTIME_BIN),
    }
  }

  /**
   * The base snapshot at accepted work's commit: every lane starts from
   * accepted work, or from a WIP's copy on it. Nothing to do before accepted
   * work is set up.
   */
  async function refreshBaseNow(r: Ready) {
    const acceptedBookmark = revsetName(lanes.repoConfig.acceptedBookmark)
    const yours = await owner.read(({ jj }) =>
      commitsOf(jj, `present(${acceptedBookmark})`),
    )
    const [commit] = yours
    if (commit === undefined) return
    const made = await refreshBase({ ...scratchOf(r), yours })
    if (made) {
      log(
        `[host] the base snapshot is at accepted work (${commit.slice(0, 8)})`,
      )
      // Accepted work moved: what it grants may have.
      await configs.refreshAccepted()
    }
  }

  /** What the scratch lane builds with. Nothing in it should see a shared directory. */
  const scratchOf = (r: Ready) => ({
    runtime,
    spec: specOf(BASE_LANE, r, true),
    env: process.env,
    open: openLinkOf(runtime),
  })

  // --- the images, runtime and base snapshot, in the background ----------
  const ready: Promise<Ready> = keeper.track(
    prepare({
      at: root,
      runtime,
      runtimeReady: found.ready,
      mountsOf: r => specOf(BASE_LANE, r).mounts,
      // The VM is told once: a port accepted work grants later reaches it
      // at the next start.
      hostPorts: configs.accepted().authority.grants.hostPorts,
      refreshBaseNow,
      log,
    }),
  )
  ready.catch(error =>
    log(`[host] lanes of their own cannot start: ${errorText(error)}`),
  )

  /** The base snapshot's refreshes, one at a time. */
  const base = createKeeper()
  async function baseAtAccepted(): Promise<void> {
    await base.run(async () => refreshBaseNow(await ready))
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
    runtime,
    lanes,
    configs,
    defaultImage,
    ready,
    hostPaths,
    specOf,
    refreshBaseSoon,
    baseAtAccepted,
  }
}

/**
 * Your repo's names, from your config and your working copy's
 * `pinetrie.json`, read once: they find accepted work, so they cannot come
 * from it. And your config's `lanes`, whose shared directories always apply.
 */
async function prepareLanes(
  at: string,
  userConfig: { readonly file: string; readonly json: unknown },
  log: (m: string) => void,
) {
  // A missing pinetrie.json is the usual case, and goes unsaid.
  const read = await readConfigFile(path.join(at, PROJECT_CONFIG_FILE))
  if (read.kind === "broken")
    log(brokenConfigLine(PROJECT_CONFIG_FILE, read.reason))
  const config = decodeLaneConfig(configJson(read), at)
  const user = decodeLaneConfig(userConfig.json, at)
  const { repoConfig: names, refused } = repoConfig(user.repo, config.repo)
  for (const r of refused) log(`[host] ${r}`)
  return { repoConfig: names, user }
}

/**
 * The images, the lane runtime, links and identity; then the runtime told
 * the default image and every mount, before the base snapshot, the first
 * lane to start.
 */
async function prepare(input: {
  readonly at: string
  readonly runtime: LaneRuntime
  readonly runtimeReady: Found["ready"]
  /** Every host path a lane of this host mounts. */
  readonly mountsOf: (r: Ready) => readonly Mount[]
  /** The ports of the Mac's loopback the project grants its lanes. */
  readonly hostPorts: readonly number[]
  readonly refreshBaseNow: (r: Ready) => Promise<void>
  readonly log: (m: string) => void
}): Promise<Ready> {
  const { at, runtime, log } = input
  const { lane, runtimeFrom } = await prepareImages(
    runtime,
    at,
    playwrightVersion(),
    log,
  )
  const refused = await checkImage(runtime, lane)
  if (refused !== null) throw new Error(refused)
  const programs = await ensureRuntime(
    runtime,
    pinetrieDir(at).runtime,
    runtimeFrom,
  )
  // Your jj config, not your repo: asked from its root, as startup asks.
  const config = async (key: string, fallback: string) => {
    const ran = await jjIn(at, ["config", "get", key])
    return ran.ok && ran.stdout.trim() !== "" ? ran.stdout.trim() : fallback
  }
  const result: Ready = {
    image: lane,
    imagePath: await runtime.imagePath(lane),
    runtime: programs,
    links: planLinks(at, await gatherLinks(at)),
    identity: {
      name: await config("user.name", `${PRODUCT_NAME} agent`),
      email: await config("user.email", "agent@pinetrie.invalid"),
    },
  }
  await input.runtimeReady({
    defaultImage: runtimeFrom,
    mounts: input.mountsOf(result),
    hostPorts: input.hostPorts,
  })
  await input.refreshBaseNow(result)
  log("[host] lanes of their own are ready")
  return result
}
