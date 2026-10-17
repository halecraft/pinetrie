// docker/runtime — Docker as a `LaneRuntime`: the facts, plan, API and CLI
// modules composed, and lanehost's roles for the disks. One code path for the Mac, through the launcher's
// socket and the host's slot, and for Linux, inside a lane or not.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { commandStream, openChannel } from "@pinetrie/channel"
import { OBSERVER_SOCKET, snapshotId } from "@pinetrie/core"
import {
  connectObserver,
  LANE_FILES,
  LANEHOST_CONTAINERFILE,
  type LanehostChannel,
  lanehostClient,
  MACHINE_SOCKET,
  OBSERVER_CONNECT,
  OBSERVER_CONTAINERFILE,
  type ObserverChannel,
  observerClient,
  observerSources,
  observerVersion,
  projectDisks,
  type Role,
  SERVER,
  serverArgs,
  TAR_OUT,
} from "@pinetrie/lanehost"
import {
  type FolderDisks,
  type LaneRuntime,
  type Mount,
  PINETRIE_MOUNT,
  planContainer,
  RUNTIME_MOUNT,
  runtimeNode,
  specHash,
} from "@pinetrie/lanes"
import {
  apiMessage,
  containerPid,
  createNetwork,
  imageEnv,
  imageExists,
  inspectContainer,
  listLabelled,
  networkExists,
  networkSubnet,
  removeContainer,
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
  imagePathOf,
  labelled,
  lanehostContainer,
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

/** A container made from `spec`, labelled with its hash, as `planContainer` decides. */
async function ensureContainer(
  target: DockerTarget,
  spec: ContainerSpec,
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
  const made = await runContainer(target, labelled(spec, want))
  // Another host may have made it at the same moment.
  if (
    made.status >= 300 &&
    (await inspectContainer(target, spec.name)).label !== want
  )
    throw new Error(`docker run ${spec.name} failed: ${apiMessage(made)}`)
}

/** The most a file of pine·trie's own on a disk may hold: `base.json` is a few hundred bytes. */
const LANE_FILE_LIMIT = 1024 * 1024

export interface DockerRuntime extends LaneRuntime {
  /** The project's folder merges, on the same lanehost: the folder adapter's alone. */
  readonly folder: FolderDisks
  /**
   * Where lanehost's server runs from: the mounts every lane gets, whose
   * targets are pine·trie's install and the lane runtime. Until then a disk
   * operation is refused, since a role's container mounts both.
   */
  serveFrom(mounts: readonly Mount[]): void
  /**
   * This project's root recorded beside its disks and its lanes' network
   * made, then the containers and disks of every project whose root is
   * gone, as the suites' throwaway projects are. Returns the gone projects'
   * keys.
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
  /** Where each call to lanehost is logged; none in the suites' own runtimes. */
  readonly log?: (line: string) => void
  /**
   * Where lanes are observed: the machine role's container, made or joined
   * here, or, for a host inside a lane, its helper's socket (`planObserver`).
   */
  readonly observer?: "container" | "forwarded"
}): DockerRuntime {
  const { target, lanesDir, root } = input
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
  /** The image, built once per runtime; a failed build is tried again. */
  let built: Promise<string> | null = null
  const lanehostImage = (): Promise<string> => {
    if (built === null) {
      const building = lanehostTag.then(async tag => {
        if (!(await imageExists(target, tag)))
          await buildImage(target, {
            file: LANEHOST_CONTAINERFILE,
            tag,
            buildArgs: [],
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
    await ensureContainer(target, renderHelper(shape, target))
    return openChannel(
      execArgv(name, [
        ...runtimeNode(`${PINETRIE_MOUNT}/${SERVER}`),
        ...serverArgs(role, lanesDir, await facts()),
      ]),
      `lanehost's ${role} role`,
    )
  }
  const lanehost = lanehostClient({
    open: openRole,
    facts,
    ...(input.log === undefined ? {} : { log: input.log }),
  })

  const version = observerSources().then(observerVersion)
  /**
   * A channel to the machine's observer: its image built and its container
   * made, by this host or joined when another host of its version made it
   * first. A container whose server is exiting, idle, refuses the
   * connection, and the next call makes it again.
   */
  async function openObserver(): Promise<ObserverChannel> {
    if (serving === null)
      throw new Error(
        "the observer cannot start yet: setup has not named pine·trie's install and the lane runtime",
      )
    const v = await version
    const name = observerContainer(v)
    const tag = observerImage(v)
    if (!(await imageExists(target, tag)))
      await buildObserverImage(target, {
        file: OBSERVER_CONTAINERFILE,
        tag,
        runtime: serving.runtime,
        packages: `${serving.install}/packages`,
      })
    await ensureContainer(target, renderObserver(v))
    return openChannel(
      execArgv(name, [
        ...runtimeNode(`${PINETRIE_MOUNT}/${OBSERVER_CONNECT}`),
        MACHINE_SOCKET,
      ]),
      "the machine's observer",
    )
  }
  const observer = observerClient({
    open:
      input.observer === "forwarded"
        ? async () => connectObserver(OBSERVER_SOCKET)
        : openObserver,
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
    serveFrom(mounts) {
      const at = (where: string) => mounts.find(m => m.target === where)?.source
      const install = at(PINETRIE_MOUNT)
      const runtime = at(RUNTIME_MOUNT)
      if (install === undefined || runtime === undefined)
        throw new Error(
          `lanehost runs from the mounts at ${PINETRIE_MOUNT} and ${RUNTIME_MOUNT}, and setup gave none`,
        )
      serving = { install, runtime }
    },
    disk: async op => {
      await lanehost.call({ kind: "disk", project: key, op })
    },
    diskExists: lane =>
      lanehost.call({ kind: "diskExists", project: key, lane }),
    snapshotExists: id =>
      lanehost.call({ kind: "snapshotExists", project: key, snapshot: id }),
    diff: (from, to) => lanehost.call({ kind: "diff", project: key, from, to }),
    readLaneFile: (snapshot, file) =>
      lanehost.call({
        kind: "read",
        project: key,
        snapshot,
        path: `${LANE_FILES}/${file}`,
        limit: LANE_FILE_LIMIT,
      }),
    folder: {
      pathFacts: (snapshot, paths) =>
        lanehost.call({ kind: "pathFacts", project: key, snapshot, paths }),
      fileDiff: (a, b, path, limit) =>
        lanehost.call({ kind: "fileDiff", project: key, a, b, path, limit }),
      diffStats: (a, b, paths) =>
        lanehost.call({ kind: "diffStats", project: key, a, b, paths }),
      filesUnder: (snapshot, paths) =>
        lanehost.call({ kind: "filesUnder", project: key, snapshot, paths }),
      sameContent: (a, b, paths) =>
        lanehost.call({ kind: "sameContent", project: key, a, b, paths }),
      applyMerge: merge =>
        lanehost.call({ kind: "applyMerge", project: key, ...merge }),
      read: (snapshot, path, limit) =>
        lanehost.call({ kind: "read", project: key, snapshot, path, limit }),
      readIn: read => lanehost.call({ kind: "readIn", project: key, ...read }),
      async *tarOut(state, paths) {
        // The call starts the disks role's container when it is not yet,
        // and refuses a snapshot that is gone before tar is asked.
        if (
          !(await lanehost.call({
            kind: "snapshotExists",
            project: key,
            snapshot: snapshotId(state),
          }))
        )
          throw new Error(`the state ${state} has no snapshot`)
        yield* commandStream(
          execArgv(lanehostContainer("disks", key, target), [
            ...runtimeNode(`${PINETRIE_MOUNT}/${TAR_OUT}`),
            disks.snapshot(snapshotId(state)),
          ]),
          { stdin: paths.map(p => `${p}\0`).join("") },
        )
      },
      states: async (lane, op) => {
        await lanehost.call({ kind: "states", project: key, lane, op })
      },
    },
    runSpec,
    async run(shape) {
      if (shape.nested)
        await lanehost.call({
          kind: "nestedDisk",
          project: key,
          lane: shape.lane,
        })
      // A bind mount's source must be there before the container is made.
      if (shape.states)
        await lanehost.call({
          kind: "statesDir",
          project: key,
          lane: shape.lane,
        })
      await projectNetworkReady()
      const spec = runSpec(shape)
      const made = await runContainer(target, labelled(spec, specHash(spec)))
      if (made.status >= 300)
        throw new Error(`docker run ${spec.name} failed: ${apiMessage(made)}`)
    },
    containerFacts: name => inspectContainer(target, name),
    observe: (container, shared, fold) =>
      observer.observe({
        fold,
        pid: async () => {
          const pid = await containerPid(target, container)
          if (pid === null) throw new Error(`${container} is not running`)
          return pid
        },
        remote: target.remoteHostPaths ? shared : [],
      }),
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
    imageExists: tag => imageExists(target, tag),
    buildImage: plan => buildImage(target, plan),
    imagePath: async tag => imagePathOf(await imageEnv(target, tag)),
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
        projects,
        containers: await listLabelled(target, PROJECT_LABEL),
      })
      for (const name of planned.containers) await removeContainer(target, name)
      for (const k of planned.projects) {
        await removeNetwork(target, projectNetwork(k))
        await firewall(k, "", [])
        await lanehost.call({ kind: "removeProject", project: k })
      }
      return planned.projects
    },
    vmRestarted() {
      lanehost.reset()
      observer.reset()
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
