// host/work/setup — what the host finds for lanes at startup, fixed after it:
// the project, opened through its adapter, the lane configs and shared
// directories, the images, runtime and grants, and the base snapshot every
// fork of accepted work starts from.

import { mkdir, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import { type ConfigPlaces, ownDirs, type StartLayers } from "@pinetrie/config"
import {
  errorText,
  isThreadId,
  isWithin,
  type ProjectRecord,
} from "@pinetrie/core"
import { createKeeper, type Keeper } from "@pinetrie/keeper"
import {
  BASE_LANE,
  checkImage,
  ensureRuntime,
  gatherLinks,
  IGNORE_FILE,
  LANE_GITCONFIG,
  type LaneFiles,
  type LaneOwner,
  type LaneRuntime,
  type LaneSpec,
  laneGitConfig,
  laneIgnores,
  type Mount,
  PINETRIE_INSTALL,
  planHostMounts,
  planLinks,
  planMounts,
  prepareImages,
  projectContainerfile,
  refreshBase,
  type SharedDir,
  slotMounts,
} from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import {
  folderCopy,
  type HostReport,
  type HostSettings,
  repoNames,
  settleHost,
  sshChoice,
} from "../settings.ts"
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

/**
 * The project, opened, and the config settled with its copies: before pi's
 * setup, which reads `model`, `skills` and `prompts` from accepted work's
 * copy. Lane work starts from it.
 */
export interface OpenedProject {
  readonly found: Found
  readonly root: string
  /** What the host keeps for the session's lanes (`sessionFiles`). */
  readonly files: LaneFiles
  readonly opened: OpenProject
  /** Each copy of `pinetrie.json` as a fact of a state, from accepted work's. */
  readonly configs: LaneConfigs
}

/**
 * Gather, settle, then act: the working copy's `pinetrie.json`, settled with
 * the start layers for your repo's names alone; the project opened with
 * them; then accepted work's copy, read through it (`startLaneConfigs`).
 * Null without tools.
 */
export async function openProject(input: {
  readonly basics: Basics
  /** What `findProject` found; null with no tools. */
  readonly found: Found | null
  /** The project's adapter, with `found`. */
  readonly adapter: ProjectAdapter | null
  /** The session's lane files, with `found`. */
  readonly files: LaneFiles | null
  readonly records: Pick<Records, "writeValues">
  readonly start: StartLayers<HostSettings>
}): Promise<OpenedProject | null> {
  const { basics, found, files } = input
  if (found === null || input.adapter === null || files === null) return null
  const { root } = found.project
  // Your repo's names find accepted work, so they come from the working
  // copy's file, read once, at startup.
  const working = await folderCopy(root, "working")
  const names = repoNames(settleHost(input.start, { working }).settled)
  // Before anything else reads the project: the reads below, lane work's
  // and the proposed changes'.
  const opened = await input.adapter.open({
    names,
    basics,
    found,
    files,
    records: input.records,
  })
  // Before anything mounts a shared directory or grants a lane anything.
  const configs = await startLaneConfigs({
    root,
    project: {
      fileAt: opened.fileAt,
      // Each time they are prepared, before they are in force: a lane that
      // mounts one finds it ignored from its container's first moment.
      prepareShared: async entries => {
        const prepared = await opened.prepareShared(entries)
        await writeLaneGit(
          files.laneGit,
          prepared.shared.map(d => d.path),
        )
        return prepared
      },
    },
    start: input.start,
    working,
    log: basics.log,
  })
  return { found, root, files, opened, configs }
}

/** The lanes' ignore file (`laneIgnores`) and git's system config, which every lane mounts. */
async function writeLaneGit(
  dir: string,
  shared: readonly string[],
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, IGNORE_FILE), laneIgnores(shared))
  await writeFile(path.join(dir, LANE_GITCONFIG), laneGitConfig())
}

export async function startSetup(input: {
  readonly basics: Basics
  /** The project, opened (`openProject`); null with no tools. */
  readonly project: OpenedProject | null
  /** Accepted work's settled config: the owner, and `lanes.ssh`. */
  readonly report: HostReport | null
  /** pine·trie's own directories, which no lane may mount; and the config directory's `ssh/`. */
  readonly places: ConfigPlaces
  /** The commands pi loaded, whose roots lanes are granted. */
  readonly setup: Pick<PiSetup, "commands">
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  /** Where lane work writes its records: lanes' ssh writes each lane's access. */
  readonly records: Pick<Records, "writeValues">
  /** The directory of the host's ssh socket, which the runtime mounts. */
  readonly sshDir: string
  readonly personalSsh: PersonalSshPlaces
}): Promise<Setup | null> {
  const { basics, keeper } = input
  const { log } = basics
  if (input.project === null || input.report === null) return null
  const { found, root, files, opened, configs } = input.project
  const { runtime, shareAndGrant } = found
  const project: ProjectRecord = {
    root,
    kind: opened.kind,
    owner: input.report.settled.owner.value,
  }
  log(
    "[host] each thread's agent works in its own container, on a disk cloned from its fork point; your working copy is /mnt/host-working-copy there, read-only",
  )

  // Before any lane is made: every lane's shape names what it attaches. The
  // project's grant is accepted work's now, and each lane's own as it runs.
  const ssh = await startLaneSsh({
    basics,
    records: input.records,
    files,
    choice: sshChoice(input.report),
    serviceDir: path.join(input.places.dirs.config, "ssh"),
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
    // A project's own skills are in each lane's copy: never mounted from here.
    roots: input.setup
      .commands()
      .map(c => c.root)
      .filter(r => !isWithin(r, root)),
    home: homedir(),
    own: ownDirs(input.places),
  })
  for (const r of hostMounts.refused)
    log(`[host] ${r.path} is not readable in lanes: ${r.reason}`)
  const hostPaths = hostMounts.mounts

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
      ignoreDir: files.laneGit,
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
      // A lane runs only on its project's kind of history.
      states: own !== null && opened.kind === "folder",
    }
  }

  /** Accepted work's states when its config was last read, for a kind with no base snapshot. */
  let configsAt: string | null = null

  /**
   * The base snapshot at accepted work's commit: every lane starts from
   * accepted work, or from a WIP's copy on it. Nothing to do before accepted
   * work is set up. A kind with no base snapshot (a folder's) reads its
   * config again each time accepted work's states move.
   */
  async function refreshBaseNow(r: Ready) {
    const accepted = await opened.acceptedNow()
    const [point] = accepted.points
    if (point === undefined) return
    const at = accepted.points.join(" ")
    const made =
      accepted.checkout === null
        ? configsAt !== at
        : await refreshBase({ ...scratchOf(r), accepted })
    configsAt = at
    if (made) {
      if (accepted.checkout !== null)
        log(
          `[host] the base snapshot is at accepted work (${point.slice(0, 8)})`,
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
      runtimeDir: files.runtime,
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
 * The images, the lane runtime, links and identity; then the runtime told
 * the default image and every mount, before the base snapshot, the first
 * lane to start.
 */
async function prepare(input: {
  readonly at: string
  /** Where the lane runtime is extracted, one directory per image tag. */
  readonly runtimeDir: string
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
  const programs = await ensureRuntime(runtime, input.runtimeDir, runtimeFrom)
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
