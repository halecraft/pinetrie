// host/work/setup — what the host finds for lanes at startup, fixed after it:
// the project, opened through its adapter, the lane configs and shared
// directories, the images, runtime and grants, and the base snapshot every
// fork of accepted work starts from.

import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import {
  errorText,
  isThreadId,
  PROJECT_CONFIG_FILE,
  type ProjectRecord,
} from "@pinetrie/core"
import { createKeeper, type Keeper } from "@pinetrie/keeper"
import {
  BASE_LANE,
  checkImage,
  configJson,
  decodeLaneConfig,
  ensureRuntime,
  gatherLinks,
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
  readConfigFile,
  refreshBase,
  type SharedDir,
  slotMounts,
} from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { decodeOwner } from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import { brokenConfigLine } from "../startup-lines.ts"
import type { OpenProject, ProjectAdapter } from "./adapter.ts"
import {
  type AcceptedLanes,
  type LaneConfigs,
  startLaneConfigs,
} from "./config.ts"
import { openLinkOf } from "./registry.ts"
import type { Found } from "./runtime.ts"
import type { Wanted } from "./shares.ts"
import { type LaneSsh, type PersonalSshPlaces, startLaneSsh } from "./ssh.ts"

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

/** The names your config and the project's `pinetrie.json` give, and your config's `lanes`, read at startup. */
export type PreparedLanes = Awaited<ReturnType<typeof prepareLanes>>

/**
 * What a host with tools found for its lanes, all of it or none
 * (`startSetup` returns null without tools): a host with tools has a
 * project, a runtime, your repo's owner and the lanes' configs.
 */
export interface Setup {
  /** What the host found where it runs, and whom its config names its owner. */
  readonly project: ProjectRecord
  /** Lanes' ssh: what each lane is given, and its owner's answers. */
  readonly ssh: LaneSsh
  /** The project's root. */
  readonly root: string
  /** The project, opened through its adapter. */
  readonly opened: OpenProject
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
  /** The project's adapter, with `found`. */
  readonly adapter: ProjectAdapter | null
  /** The user's config, as read at startup: its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  /** The commands pi loaded, whose roots lanes are granted. */
  readonly setup: Pick<PiSetup, "commands" | "agentDir">
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  /** Where lane work writes its records: lanes' ssh writes each lane's access. */
  readonly records: Pick<Records, "writeValues">
  /** The directory of the host's ssh socket, which the runtime mounts. */
  readonly sshDir: string
  readonly personalSsh: PersonalSshPlaces
}): Promise<Setup | null> {
  const { basics, keeper, found } = input
  const { log } = basics
  if (found === null || input.adapter === null) return null
  const { runtime, shareAndGrant } = found
  const { root } = found.project
  const project: ProjectRecord = {
    root,
    owner: decodeOwner(input.userConfig.json),
  }
  log(
    "[host] each thread's agent works in its own container, on a disk cloned from its fork point; your working copy is /mnt/host-working-copy there, read-only",
  )

  // Before the rest, since a run's prompt names the shared directories.
  const lanes = await prepareLanes(root, input.userConfig, log)
  // Before anything else reads the project: the reads below, lane work's
  // and the offers'.
  const opened = await input.adapter.open({ written: lanes.written, basics })
  // Before anything mounts a shared directory or grants a lane anything.
  const configs = await startLaneConfigs({
    root,
    project: opened,
    user: lanes.user,
    userFile: input.userConfig.file,
    log,
  })
  // Before any lane is made: every lane's shape names what it attaches. The
  // project's grant is accepted work's now, and each lane's own as it runs.
  const ssh = await startLaneSsh({
    basics,
    records: input.records,
    root,
    userConfig: input.userConfig,
    projectGrant: configs.accepted().authority.grants.ssh,
    laneGrant: lane => configs.laneConfig(lane).grants.ssh,
    owner: project.owner,
    personal: input.personalSsh,
    dir: input.sshDir,
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

  // The runtime's and the ignore file's directories are parameters, not
  // derived from the project root: a project's may lie outside it.
  const mountsFor = (
    r: Ready,
    grants: readonly Mount[],
    shared: readonly SharedDir[],
    withHostPaths: boolean,
  ): readonly Mount[] =>
    planMounts({
      hostWorkingCopy: root,
      pinetrie: PINETRIE_INSTALL,
      runtime: r.runtime,
      ignoreDir: pinetrieDir(root).laneGit,
      links: r.links,
      grants,
      shared,
      hostPaths: withHostPaths ? hostPaths : [],
    })

  /**
   * What lanes of this host may mount and reach under `accepted`: on the Mac
   * every directory is shared into a slot before any lane names it.
   */
  const wantedFor = (r: Ready, accepted: AcceptedLanes): Wanted => ({
    mounts: slotMounts({
      base: mountsFor(r, accepted.authority.grants.mounts, [], true),
      shared: accepted.shared,
      attached: ssh.mounts,
    }),
    hostPorts: accepted.authority.grants.hostPorts,
  })

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
      mounts: mountsFor(
        r,
        grants.mounts,
        own === null ? [] : configs.laneShared(own),
        !base,
      ),
      grants: {
        nested: grants.nested,
        hostPorts: grants.hostPorts,
        env: grants.env,
      },
      attached: ssh.attachedFor(lane),
      identity: r.identity,
      memory: LANE_MEMORY,
    }
  }

  /**
   * The base snapshot at accepted work's commit: every lane starts from
   * accepted work, or from a WIP's copy on it. Nothing to do before accepted
   * work is set up.
   */
  async function refreshBaseNow(r: Ready) {
    const yours = await opened.acceptedNow()
    const [commit] = yours
    if (commit === undefined) return
    const made = await refreshBase({
      ...scratchOf(r),
      yours,
      checkout: fresh => opened.baseSteps({ yours, fresh }),
    })
    if (made) {
      log(
        `[host] the base snapshot is at accepted work (${commit.slice(0, 8)})`,
      )
      // Accepted work moved: what it grants may have. Shared before it is in
      // force, so no lane names a directory no slot holds; a failed share is
      // said, and lanes naming what it lacks say why they cannot start.
      const next = await configs.readAccepted()
      await shareAndGrant(wantedFor(r, next)).catch(error =>
        log(`[host] ${errorText(error)}`),
      )
      configs.takeAccepted(next)
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
      wanted: r => wantedFor(r, configs.accepted()),
      identity: () => opened.identity(),
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
    ssh,
    root,
    opened,
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
 * Your repo's names as your config and your working copy's `pinetrie.json`
 * write them, read once: they find accepted work, so they cannot come from
 * it; the adapter decides them. And your config's `lanes`, whose shared
 * directories always apply.
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
  return { written: { user: user.repo, project: config.repo }, user }
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
  /** Every host path a lane of this host mounts, and the ports it reaches. */
  readonly wanted: (r: Ready) => Wanted
  /** The identity lanes commit as (`OpenProject.identity`). */
  readonly identity: () => Promise<Ready["identity"]>
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
  const result: Ready = {
    image: lane,
    imagePath: await runtime.imagePath(lane),
    runtime: programs,
    links: planLinks(at, await gatherLinks(at)),
    identity: await input.identity(),
  }
  await input.runtimeReady({
    defaultImage: runtimeFrom,
    ...input.wanted(result),
  })
  await input.refreshBaseNow(result)
  log("[host] lanes of their own are ready")
  return result
}
