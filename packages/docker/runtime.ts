// docker/runtime — Docker as a `LaneRuntime`: the facts, plan, API and CLI
// modules composed, and lanehost's roles for the disks. One code path for the Mac, through the launcher's
// socket and the host's slot, and for Linux, inside a lane or not.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { commandStream, openChannel } from "@pinetrie/channel"
import { OBSERVER_SOCKET } from "@pinetrie/core"
import {
  type Install,
  inMount,
  PINETRIE_MOUNT,
  type ScriptName,
  scriptCommand,
} from "@pinetrie/install"
import {
  connectObserver,
  LANEHOST_CONTAINERFILE,
  type LanehostChannel,
  lanehostClient,
  lanehostDisks,
  MACHINE_SOCKET,
  OBSERVER_CONTAINERFILE,
  type ObserverChannel,
  type ObserverClient,
  observerClient,
  observerSources,
  observerVersion,
  projectDisks,
  type Role,
  serverArgs,
} from "@pinetrie/lanehost"
import {
  baseLane,
  type FolderDisks,
  type ImageBuild,
  type ImagePlan,
  type LaneRuntime,
  type Mount,
  planContainer,
  RUNTIME_MOUNT,
  RUNTIME_NODE,
  type Served,
  specHash,
} from "@pinetrie/lanes"
import {
  apiMessage,
  containerImageIds,
  containerPid,
  createNetwork,
  imageEnv,
  imageExists,
  inspectContainer,
  isImageRemovalSettled,
  listImages,
  listLabelled,
  networkExists,
  networkSubnet,
  removeContainer,
  removeImage,
  removeNetwork,
  runContainer,
  startContainer,
  stopContainer,
} from "./api.ts"
import {
  buildImage,
  buildObserverImage,
  dockerArgv,
  runInImage,
} from "./cli.ts"
import { dockerRootless, hostPathExists } from "./facts.ts"
import {
  type ContainerSpec,
  imageEnvPath,
  labelled,
  lanehostContainer,
  NESTED_DISK,
  observerContainer,
  observerImage,
  PROJECT_LABEL,
  planProjectSweep,
  planSlotSweep,
  projectKey,
  projectNetwork,
  renderHelper,
  renderObserver,
  renderRun,
  unneededImageTags,
} from "./plan.ts"
import { NESTED_PROFILE } from "./seccomp-nested.ts"
import type { DockerTarget } from "./target.ts"

/** The project's lanes' network, labelled with it for the sweep. */
async function ensureNetwork(target: DockerTarget, key: string): Promise<void> {
  const network = projectNetwork(key)
  if (await networkExists(target, network)) return
  const made = await createNetwork(target, network, { [PROJECT_LABEL]: key })
  // Another host of the project may have made it at the same moment.
  if (made.status >= 300 && !(await networkExists(target, network)))
    throw new Error(`docker network create ${network}: ${apiMessage(made)}`)
}

/**
 * How an image a host needs is built: from a Containerfile, or the observer's
 * build, which takes the lane runtime and pine·trie's packages as named
 * contexts.
 */
type ImageRecipe =
  | { readonly kind: "containerfile"; readonly plan: ImagePlan }
  | {
      readonly kind: "observer"
      readonly tag: string
      readonly file: string
      readonly runtime: string
      readonly packages: string
    }

const recipeTag = (recipe: ImageRecipe): string =>
  recipe.kind === "containerfile" ? recipe.plan.tag : recipe.tag

/** A container made from `spec`, labelled with its hash, as `planContainer` decides. */
async function ensureContainer(
  target: DockerTarget,
  spec: ContainerSpec,
  buildMissing: (image: string) => Promise<boolean>,
): Promise<void> {
  const want = specHash(spec)
  const decided = planContainer({
    facts: await inspectContainer(target, spec.name),
    want,
  })
  if (decided === "running") return
  if (decided === "start") {
    await startContainer(target, spec.name)
    return
  }
  if (decided === "recreate") await removeContainer(target, spec.name)
  const made = await runContainer(target, labelled(spec, want), buildMissing)
  // Another host may have made it at the same moment.
  if (
    made.status >= 300 &&
    (await inspectContainer(target, spec.name)).label !== want
  )
    throw new Error(`docker run ${spec.name} failed: ${apiMessage(made)}`)
}

export interface DockerRuntime extends LaneRuntime {
  /** The project's folder merges, on the same lanehost: the folder adapter's alone. */
  readonly folder: FolderDisks
  /**
   * Where lanehost's server runs from: the mounts every lane gets, whose
   * targets are pine·trie's install and the lane runtime. Until then a disk
   * operation is refused, since a role's container mounts both. The
   * observer is built from the same two, and is reached only through what
   * this returns. Called once per runtime.
   */
  serveFrom(mounts: readonly Mount[]): Served
  /**
   * This project's root recorded beside its disks and its lanes' network
   * made, then the containers and disks of every project whose root is
   * gone, as the suites' throwaway projects are, and the containers in the
   * lanes directory of projects it does not hold (`planProjectSweep`).
   * Returns the gone projects' keys.
   */
  sweepProjects(): Promise<readonly string[]>
  /**
   * The project's grant of the host's ports (`lanes.hostPorts`), in the
   * lane VM's firewall, replacing the last. False where the target has no
   * host address (Linux), and nothing is done.
   */
  grantHostPorts(ports: readonly number[]): Promise<boolean>
  /**
   * The VM started again (a new lease): lanehost's channels are closed, and
   * its containers and the project's network are made again at the next
   * call that needs them, as they were at the first.
   */
  vmRestarted(): void
}

/** Docker, at `target`, keeping the lanes of the project at `root` under `lanesDir`. */
export function dockerRuntime(input: {
  readonly target: DockerTarget
  /** The lanes directory, on Docker's machine. */
  readonly lanesDir: string
  /** The project's root on the host. */
  readonly root: string
  /**
   * The pine·trie install lanehost and the observer run: its root on the
   * host, read for the observer's image, and its form, which names each
   * script it starts in the mount.
   */
  readonly install: Install
  /**
   * Where each call to lanehost, and an image it could not remove, is
   * logged; none in the suites' own runtimes.
   */
  readonly log?: (line: string) => void
  /**
   * Where lanes are observed: the machine role's container, made or joined
   * here, or, for a host inside a lane, its helper's socket (`planObserver`).
   */
  readonly observer?: "container" | "forwarded"
  /** Told before each image this runtime builds. */
  readonly building?: (image: ImageBuild) => void
}): DockerRuntime {
  const { target, lanesDir, root, install } = input
  /** `name` started in a container, from the install as it is mounted there. */
  const inContainer = (name: ScriptName) =>
    scriptCommand(inMount(install), name, RUNTIME_NODE)
  const key = projectKey(root)
  const disks = projectDisks(lanesDir, key)
  const runSpec = (shape: Parameters<LaneRuntime["runSpec"]>[0]) =>
    renderRun(shape, { target, disks, project: key, seccomp: NESTED_PROFILE })
  const execArgv = (container: string, argv: readonly string[]) => [
    ...dockerArgv(target),
    "exec",
    "-i",
    container,
    ...argv,
  ]

  const lanehostTag = readFile(LANEHOST_CONTAINERFILE, "utf8").then(
    content =>
      `pinetrie-lanehost:${createHash("sha256").update(content).digest("hex").slice(0, 12)}`,
  )
  const version = observerSources(install.root).then(observerVersion)

  /** Every image this host has ensured, by tag: what it needs, and how to build each again. */
  const recipes = new Map<string, ImageRecipe>()
  /** The tags this host needs: those it ensured, and its lanehost and observer images, built or not. */
  const neededTags = async (): Promise<ReadonlySet<string>> =>
    new Set([
      ...recipes.keys(),
      await lanehostTag,
      observerImage(await version),
    ])
  async function removeUnneededImages(): Promise<void> {
    const [listedImages, imageIdsContainersUse, needed] = await Promise.all([
      listImages(target),
      containerImageIds(target),
      neededTags(),
    ])
    if (imageIdsContainersUse === null) return
    for (const tag of unneededImageTags({
      neededTags: needed,
      listedImages,
      imageIdsContainersUse,
    })) {
      const removed = await removeImage(target, tag)
      if (!isImageRemovalSettled(removed))
        input.log?.(`[host] could not remove ${tag}: ${apiMessage(removed)}`)
    }
  }
  async function build(recipe: ImageRecipe): Promise<void> {
    input.building?.(
      recipe.kind === "observer"
        ? "observer"
        : recipe.plan.file === LANEHOST_CONTAINERFILE
          ? "lanehost"
          : "lane",
    )
    if (recipe.kind === "containerfile") await buildImage(target, recipe.plan)
    else await buildObserverImage(target, recipe)
    // Only after a build: a host that builds nothing has nothing newer to
    // keep, and may share this Docker with a host of the older version.
    await removeUnneededImages()
  }
  /** Record `recipe` as needed, and build its tag unless Docker has it. */
  async function ensureImage(recipe: ImageRecipe): Promise<void> {
    recipes.set(recipeTag(recipe), recipe)
    if (await imageExists(target, recipeTag(recipe))) return
    await build(recipe)
  }
  /** A tag another host removed after this one ensured it, built again. */
  const buildMissing = async (image: string): Promise<boolean> => {
    const recipe = recipes.get(image)
    if (recipe === undefined) return false
    await build(recipe)
    return true
  }

  /** The image, ensured once per runtime; a failed build is tried again. */
  let built: Promise<string> | null = null
  const lanehostImage = (): Promise<string> => {
    if (built === null) {
      const building = lanehostTag.then(async tag => {
        await ensureImage({
          kind: "containerfile",
          plan: { file: LANEHOST_CONTAINERFILE, tag, buildArgs: [] },
        })
        return tag
      })
      built = building
      building.catch(() => {
        built = null
      })
    }
    return built
  }
  /** What `serveFrom` named; lanehost's roles refuse to start before it. */
  let serving: { install: string; runtime: string } | null = null
  let rootless: Promise<boolean> | null = null
  const facts = async () => {
    rootless ??= dockerRootless(target)
    return { rootless: await rootless }
  }
  async function openRole(role: Role): Promise<LanehostChannel> {
    if (serving === null)
      throw new Error(
        "lanehost cannot start yet: setup has not named pine·trie's install and the lane runtime",
      )
    const name = lanehostContainer(role, key, target)
    const shape = {
      role,
      project: key,
      image: await lanehostImage(),
      lanesDir,
      root,
      ...serving,
    }
    await ensureContainer(target, renderHelper(shape, target), buildMissing)
    return openChannel(
      execArgv(name, [
        ...inContainer("lanehostServer"),
        ...serverArgs(role, lanesDir, await facts(), NESTED_DISK),
      ]),
      `lanehost's ${role} role`,
    )
  }
  const lanehost = lanehostClient({
    open: openRole,
    facts,
    ...(input.log === undefined ? {} : { log: input.log }),
  })

  /**
   * A channel to the machine's observer: its image built and its container
   * made, by this host or joined when another host of its version made it
   * first. A container whose server is exiting, idle, refuses the
   * connection, and the next call makes it again.
   */
  async function openObserver(
    from: NonNullable<typeof serving>,
  ): Promise<ObserverChannel> {
    const v = await version
    const name = observerContainer(v)
    await ensureImage({
      kind: "observer",
      tag: observerImage(v),
      file: OBSERVER_CONTAINERFILE,
      runtime: from.runtime,
      packages: `${from.install}/packages`,
    })
    await ensureContainer(target, renderObserver(v, install), buildMissing)
    return openChannel(
      execArgv(name, [...inContainer("observerConnect"), MACHINE_SOCKET]),
      "the machine's observer",
    )
  }
  /** Made by `serveFrom`, from what it names. */
  let observer: ObserverClient | null = null
  const observerFrom = (from: NonNullable<typeof serving>): ObserverClient =>
    observerClient({
      open:
        input.observer === "forwarded"
          ? async () =>
              connectObserver(
                scriptCommand(install, "observerConnect", [process.execPath]),
                OBSERVER_SOCKET,
              )
          : () => openObserver(from),
    })

  /** The project's lanes' network, labelled for the sweep; made once per VM. */
  let network: Promise<void> | null = null
  const projectNetworkReady = (): Promise<void> => {
    if (network === null) {
      const making = ensureNetwork(target, key)
      network = making
      making.catch(() => {
        network = null
      })
    }
    return network
  }

  /** The project's disks, on lanehost; a stream command is a `docker exec -i` in the disks role's container. */
  const projectDisksCalls = lanehostDisks({
    call: lanehost.call,
    key,
    out: (command, snapshot, stdin) =>
      commandStream(
        execArgv(lanehostContainer("disks", key, target), [
          ...inContainer(command === "tar" ? "tarOut" : "fileOut"),
          disks.snapshot(snapshot),
        ]),
        { stdin },
      ),
  })

  /** A project's grant rules, by lanehost's privileged role on the VM's own network. */
  async function firewall(
    k: string,
    subnet: string,
    ports: readonly number[],
  ): Promise<void> {
    if (target.hostAddress === null) return
    await lanehost.call({
      kind: "grant",
      project: k,
      subnet,
      hostAddress: target.hostAddress,
      ports,
    })
  }

  return {
    baseLane: baseLane(key),
    serveFrom(mounts) {
      const at = (where: string) => mounts.find(m => m.target === where)?.source
      const mounted = at(PINETRIE_MOUNT)
      const runtime = at(RUNTIME_MOUNT)
      if (mounted === undefined || runtime === undefined)
        throw new Error(
          `lanehost runs from the mounts at ${PINETRIE_MOUNT} and ${RUNTIME_MOUNT}, and setup gave none`,
        )
      const from = { install: mounted, runtime }
      serving = from
      const client = observerFrom(from)
      observer = client
      return {
        async observer() {
          await client.connect()
          return {
            observe: (container, shared, fold) =>
              client.observe({
                fold,
                pid: async () => {
                  const pid = await containerPid(target, container)
                  if (pid === null)
                    throw new Error(`${container} is not running`)
                  return pid
                },
                remote: target.remoteHostPaths ? shared : [],
              }),
          }
        },
      }
    },
    ...projectDisksCalls,
    runSpec,
    // The folders a shape binds are made by its start's plan, before this.
    async run(shape) {
      await projectNetworkReady()
      const spec = runSpec(shape)
      const made = await runContainer(
        target,
        labelled(spec, specHash(spec)),
        buildMissing,
      )
      if (made.status >= 300)
        throw new Error(`docker run ${spec.name} failed: ${apiMessage(made)}`)
    },
    containerFacts: name => inspectContainer(target, name),
    async start(name) {
      await startContainer(target, name)
    },
    // Docker's disk needs nothing after a stop: btrfs frees what a lane deletes.
    async stop(name) {
      await stopContainer(target, name)
    },
    async remove(name) {
      await removeContainer(target, name)
    },
    execArgv,
    async ensureLaneImages(plans) {
      // Every plan recorded before any builds: a build removes what is not.
      for (const plan of plans)
        recipes.set(plan.tag, { kind: "containerfile", plan })
      for (const plan of plans)
        await ensureImage({ kind: "containerfile", plan })
    },
    imagePath: async tag => imageEnvPath(await imageEnv(target, tag)),
    runInImage: (tag, argv) => runInImage(target, tag, argv),
    async sweepProjects() {
      await lanehost.call({ kind: "record", project: key, root })
      // Made at startup, so no lane's start waits for it.
      await projectNetworkReady()
      const projects = []
      for (const p of await lanehost.call({ kind: "projects" })) {
        if (p.key === key) continue
        projects.push({
          key: p.key,
          rootExists: p.root !== null && (await hostPathExists(p.root)),
        })
      }
      const planned = planProjectSweep({
        ownKey: key,
        lanesDir,
        projects,
        containers: await listLabelled(target, PROJECT_LABEL),
      })
      for (const name of planned.containers) await removeContainer(target, name)
      for (const k of planned.projects) {
        await removeNetwork(target, projectNetwork(k))
        await firewall(k, "", [])
        await lanehost.call({ kind: "remove-project", project: k })
      }
      for (const k of planned.unlistedNetworks)
        await removeNetwork(target, projectNetwork(k))
      return planned.projects
    },
    vmRestarted() {
      lanehost.reset()
      observer?.reset()
      built = null
      network = null
    },
    async grantHostPorts(ports) {
      if (target.hostAddress === null) return false
      await projectNetworkReady()
      await firewall(
        key,
        await networkSubnet(target, projectNetwork(key)),
        ports,
      )
      return true
    },
  }
}

/**
 * Before a slot is filled: remove every container of any project with a bind
 * under `root`, the slot's place in Docker's machine, left by a host that died
 * holding it. Returns their names.
 */
export async function sweepSlot(
  target: Pick<DockerTarget, "socket">,
  root: string,
): Promise<readonly string[]> {
  const names = planSlotSweep(root, await listLabelled(target, PROJECT_LABEL))
  for (const name of names) await removeContainer(target, name)
  return names
}
