// container/cli — the `container` commands a lane runtime runs.

import path from "node:path"
import {
  type DiskOp,
  describeFailure,
  hostBytesRunner,
  type ImagePlan,
  type Ran,
  run,
} from "@pinetrie/lanes"
import { containerFacts } from "./facts.ts"
import { type DiskPaths, parseImagePath, planDiskCommands } from "./plan.ts"

/** `planDiskCommands`' commands, in order, stopping at the first that fails. */
export async function runDisk(op: DiskOp, paths: DiskPaths): Promise<void> {
  const { commands, ignoreFailure } = planDiskCommands(op, paths)
  for (const [program = "", ...args] of commands) {
    const ran = await run(program, args)
    if (!ran.ok && !ignoreFailure)
      throw new Error(describeFailure(`${program} ${args.join(" ")}`, ran))
  }
}

/** Run `container` with `args`, throwing on failure. */
async function container(args: readonly string[]): Promise<void> {
  const ran = await run("container", args)
  if (!ran.ok)
    throw new Error(describeFailure(`container ${args[0] ?? ""}`, ran))
}

export const startContainer = (name: string): Promise<void> =>
  container(["start", name])

export const runContainer = (args: readonly string[]): Promise<void> =>
  container(args)

/**
 * Stop a running container, then trim its disk, so it gives back the space
 * the lane deleted. A container that is not running is left alone. A lane's
 * volume has its container's name (`laneVolume`).
 */
export async function stopContainer(
  name: string,
  trimImage: () => Promise<string>,
): Promise<void> {
  if ((await containerFacts(name)).state !== "running") return
  await container(["stop", name])
  await trim(name, await trimImage())
}

/** Delete a container, running or not; one that is not there is no failure. */
export async function removeContainer(name: string): Promise<void> {
  await run("container", ["rm", "-f", name])
}

/**
 * Give back the space a lane deleted, on its stopped disk, in a short-lived
 * container with `CAP_SYS_ADMIN` (S40 item 8). A lane's own container never
 * has that capability.
 */
async function trim(volume: string, image: string): Promise<void> {
  const ran = await run("container", [
    "run",
    "--rm",
    "--cap-add",
    "CAP_SYS_ADMIN",
    "-v",
    `${volume}:/disk`,
    image,
    "fstrim",
    "/disk",
  ])
  if (!ran.ok) throw new Error(describeFailure("fstrim", ran))
}

export const imageExists = async (tag: string): Promise<boolean> =>
  (await run("container", ["image", "inspect", tag])).ok

/** Build `plan`'s image, then stop the builder: it holds 2 GiB while it runs (S42). */
export async function buildImage(plan: ImagePlan): Promise<void> {
  const built = await run("container", [
    "build",
    "-t",
    plan.tag,
    ...plan.buildArgs.flatMap(a => ["--build-arg", a]),
    "-f",
    plan.file,
    path.dirname(plan.file),
  ])
  await run("container", ["builder", "stop"])
  if (!built.ok) throw new Error(describeFailure("container build", built))
}

export async function imagePath(tag: string): Promise<string> {
  const ran = await run("container", ["image", "inspect", tag])
  if (!ran.ok) throw new Error(describeFailure("container image inspect", ran))
  return parseImagePath(ran.stdout)
}

export const runInImage = (
  tag: string,
  argv: readonly string[],
): Promise<Ran<Uint8Array>> =>
  hostBytesRunner()(["container", "run", "--rm", tag, ...argv])
