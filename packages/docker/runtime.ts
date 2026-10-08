// docker/runtime — Docker as a `LaneRuntime` (ADR-0103): the facts, plan and
// CLI modules composed. One code path for the Mac, through the launcher's
// socket and the host's slot, and for Linux, inside a lane or not.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  type LaneOwner,
  type LaneRuntime,
  planContainer,
  SPEC_LABEL,
  specHash,
} from "@pinetrie/lanes"
import {
  buildImage,
  docker,
  dockerArgv,
  dockerOrThrow,
  imageExists,
  imagePath,
  inDisks,
  runInImage,
} from "./cli.ts"
import { containerFacts, hostPathExists, listLabelled } from "./facts.ts"
import {
  DISKS_CONTAINER,
  isSubvolume,
  labelled,
  PROJECT_LABEL,
  planDiskCommand,
  planDisksHelper,
  planHostPortRules,
  planNestedDisk,
  planProjectRecord,
  planProjectSweep,
  planSlotSweep,
  projectDisks,
  projectKey,
  projectNetwork,
  renderRun,
  SLOT_LABEL,
  subvolumeCheck,
} from "./plan.ts"
import { NESTED_PROFILE } from "./seccomp-nested.ts"
import type { DockerTarget } from "./target.ts"

const DISKS_FILE = path.join(import.meta.dirname, "disks.Containerfile")

/** A container made from `args`, labelled with their hash, as `planContainer` decides. */
async function ensureContainer(
  target: DockerTarget,
  name: string,
  args: readonly string[],
): Promise<void> {
  const want = specHash(args)
  const decided = planContainer({
    facts: await containerFacts(target, name),
    want,
  })
  if (decided === "running") return
  if (decided === "start") {
    await dockerOrThrow(target, ["start", name])
    return
  }
  if (decided === "recreate") await docker(target, ["rm", "-f", name])
  const made = await docker(target, labelled(args, `${SPEC_LABEL}=${want}`))
  // Another host may have made it at the same moment.
  if (!made.ok && (await containerFacts(target, name)).label !== want)
    throw new Error(`docker run ${name} failed: ${made.stderr.trim()}`)
}

export interface DockerRuntime extends LaneRuntime {
  /**
   * The containers and disks of every project whose root is gone, as the
   * suites' throwaway projects are. Returns the projects' keys.
   */
  sweepProjects(): Promise<readonly string[]>
  /**
   * pre-docker: a host command that reads a tar on its stdin into `lane`'s
   * disk, which must exist (`create`).
   */
  importArgv(lane: LaneOwner): readonly string[]
  /**
   * The project's grant of the host's ports (`lanes.hostPorts`), in the
   * lane VM's firewall, replacing the last. False where the target has no
   * host address (Linux), and nothing is done.
   */
  grantHostPorts(ports: readonly number[]): Promise<boolean>
  /**
   * The VM started again (a new lease): the disks helper and the project's
   * network are made again at the next disk operation, as they were at the
   * first.
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
}): DockerRuntime {
  const { target, lanesDir, root } = input
  const key = projectKey(root)
  const disks = projectDisks(lanesDir, key)
  const runArgs = (shape: Parameters<LaneRuntime["runArgs"]>[0]) =>
    renderRun(shape, { target, disks, project: key, seccomp: NESTED_PROFILE })

  const disksTag = readFile(DISKS_FILE, "utf8").then(
    content =>
      `pinetrie-disks:${createHash("sha256").update(content).digest("hex").slice(0, 12)}`,
  )
  async function startHelper(): Promise<void> {
    const tag = await disksTag
    if (!(await imageExists(target, tag)))
      await buildImage(target, { file: DISKS_FILE, tag, buildArgs: [] })
    // The project's lanes' network, labelled for the sweep.
    const network = projectNetwork(key)
    if (!(await docker(target, ["network", "inspect", network])).ok) {
      const made = await docker(target, [
        "network",
        "create",
        "--label",
        `${PROJECT_LABEL}=${key}`,
        network,
      ])
      // Another host of the project may have made it at the same moment.
      if (
        !made.ok &&
        !(await docker(target, ["network", "inspect", network])).ok
      )
        throw new Error(
          `docker network create ${network}: ${made.stderr.trim()}`,
        )
    }
    await ensureContainer(
      target,
      DISKS_CONTAINER,
      planDisksHelper(lanesDir, tag),
    )
    await disksOrThrow(planProjectRecord(disks, root), false)
  }
  let helper: Promise<void> | null = null
  /** The helper, started once per runtime; a failed start is tried again next time. */
  const helperReady = (): Promise<void> => {
    if (helper === null) {
      const started = startHelper()
      helper = started
      started.catch(() => {
        helper = null
      })
    }
    return helper
  }
  async function disksOrThrow(argv: readonly string[], wait = true) {
    if (wait) await helperReady()
    const ran = await inDisks(target, argv)
    if (!ran.ok)
      throw new Error(
        `a disk operation failed (exit ${ran.code}): ${ran.stderr.trim().split("\n")[0] ?? ""}`,
      )
    return ran
  }
  /** A project's grant rules, in a throwaway container on the VM's own network. */
  async function firewall(
    k: string,
    subnet: string,
    ports: readonly number[],
  ): Promise<void> {
    if (target.hostAddress === null) return
    await dockerOrThrow(target, [
      "run",
      "--rm",
      "--network",
      "host",
      "--cap-add",
      "NET_ADMIN",
      "--cap-add",
      "NET_RAW",
      await disksTag,
      ...planHostPortRules({
        key: k,
        subnet,
        hostAddress: target.hostAddress,
        ports,
      }),
    ])
  }
  const subvolumeAt = async (at: string) => {
    await helperReady()
    const ran = await inDisks(target, subvolumeCheck(at))
    return ran.ok && isSubvolume(ran.stdout)
  }

  return {
    disk: async op => {
      await disksOrThrow(planDiskCommand(op, disks))
    },
    diskExists: lane => subvolumeAt(disks.lane(lane)),
    snapshotExists: id => subvolumeAt(disks.snapshot(id)),
    runArgs,
    async run(shape) {
      if (shape.nested) await disksOrThrow(planNestedDisk(disks, shape.lane))
      const args = runArgs(shape)
      await dockerOrThrow(
        target,
        labelled(args, `${SPEC_LABEL}=${specHash(args)}`),
      )
    },
    containerFacts: name => containerFacts(target, name),
    async start(name) {
      await dockerOrThrow(target, ["start", name])
    },
    // Docker's disk needs nothing after a stop: btrfs frees what a lane deletes.
    async stop(name) {
      await docker(target, ["stop", name])
    },
    async remove(name) {
      await docker(target, ["rm", "-f", name])
    },
    execArgv: (container, argv) => [
      ...dockerArgv(target),
      "exec",
      "-i",
      container,
      ...argv,
    ],
    imageExists: tag => imageExists(target, tag),
    buildImage: plan => buildImage(target, plan),
    imagePath: tag => imagePath(target, tag),
    runInImage: (tag, argv) => runInImage(target, tag, argv),
    importArgv: lane => [
      ...dockerArgv(target),
      "exec",
      "-i",
      DISKS_CONTAINER,
      "tar",
      "-xpf",
      "-",
      "-C",
      disks.lane(lane),
    ],
    async sweepProjects() {
      const listed = await disksOrThrow([
        "sh",
        "-c",
        'for d in "$1"/projects/*/; do [ -d "$d" ] || continue; printf "%s\\t%s\\n" "$(basename "$d")" "$(cat "$d/root" 2>/dev/null)"; done',
        "sh",
        lanesDir,
      ])
      const projects = []
      for (const line of listed.stdout.split("\n")) {
        const [k, r] = line.split("\t")
        if (k === undefined || k === "" || k === key) continue
        projects.push({
          key: k,
          rootExists: r !== undefined && r !== "" && (await hostPathExists(r)),
        })
      }
      const planned = planProjectSweep({
        projects,
        containers: await listLabelled(target, PROJECT_LABEL),
      })
      for (const name of planned.containers)
        await docker(target, ["rm", "-f", name])
      for (const k of planned.projects) {
        await docker(target, ["network", "rm", projectNetwork(k)])
        await firewall(k, "", [])
        await disksOrThrow([
          "sh",
          "-c",
          'cd "$1" && for s in */*/; do btrfs -q subvolume delete "$s" 2>/dev/null || true; done; cd / && rm -rf "$1"',
          "sh",
          projectDisks(lanesDir, k).dir,
        ])
      }
      return planned.projects
    },
    vmRestarted() {
      helper = null
    },
    async grantHostPorts(ports) {
      if (target.hostAddress === null) return false
      await helperReady()
      const inspected = await dockerOrThrow(target, [
        "network",
        "inspect",
        "-f",
        "{{(index .IPAM.Config 0).Subnet}}",
        projectNetwork(key),
      ])
      await firewall(key, inspected.stdout.trim(), ports)
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
  for (const name of names) await docker(target, ["rm", "-f", name])
  return names
}
