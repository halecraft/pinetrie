// docker/runtime — Docker as a `LaneRuntime`: the facts, plan, API and CLI
// modules composed, and lanehost's roles for the disks. One code path for the Mac, through the launcher's
// socket and the host's slot, and for Linux, inside a lane or not.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { openChannel } from "@pinetrie/channel"
import {
  LANEHOST_CONTAINERFILE,
  type LanehostChannel,
  lanehostClient,
  projectDisks,
  type Role,
  SERVER,
  serverArgs,
} from "@pinetrie/lanehost"
import {
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
import { buildImage, dockerArgv, runInImage } from "./cli.ts"
import { dockerRootless, hostPathExists } from "./facts.ts"
import {
  type ContainerSpec,
  imagePathOf,
  labelled,
  lanehostContainer,
  PROJECT_LABEL,
  planProjectSweep,
  planSlotSweep,
  projectKey,
  projectNetwork,
  renderHelper,
  renderRun,
  SLOT_LABEL,
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

export interface DockerRuntime extends LaneRuntime {
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
    snapshots: () => lanehost.call({ kind: "snapshots", project: key }),
    readLaneFile: (snapshot, file) =>
      lanehost.call({ kind: "read", project: key, snapshot, file }),
    runSpec,
    async run(shape) {
      if (shape.nested)
        await lanehost.call({
          kind: "nestedDisk",
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
 * Before a slot is filled: remove every container labelled with it, left by
 * a host that died holding it. Returns their names.
 */
export async function sweepSlot(
  target: DockerTarget,
  slot: number,
): Promise<readonly string[]> {
  const names = planSlotSweep(
    slot,
    await listLabelled(target, `${SLOT_LABEL}=${slot}`),
  )
  for (const name of names) await removeContainer(target, name)
  return names
}
