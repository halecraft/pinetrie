// docker/cli — the docker commands a lane runtime runs, against the target's
// socket (`-H`).

import path from "node:path"
import {
  describeFailure,
  hostBytesRunner,
  type ImagePlan,
  type Ran,
  run,
} from "@pinetrie/lanes"
import { DISKS_CONTAINER, parseImagePath } from "./plan.ts"
import type { DockerTarget } from "./target.ts"

/** The docker CLI against the target's socket. */
export const dockerArgv = (
  target: Pick<DockerTarget, "socket">,
): readonly string[] => ["docker", "-H", `unix://${target.socket}`]

export const docker = (
  target: Pick<DockerTarget, "socket">,
  args: readonly string[],
): Promise<Ran> => {
  const [program = "docker", ...rest] = dockerArgv(target)
  return run(program, [...rest, ...args])
}

/** `docker` with `args`, throwing on failure with the command named. */
export async function dockerOrThrow(
  target: Pick<DockerTarget, "socket">,
  args: readonly string[],
): Promise<Ran> {
  const ran = await docker(target, args)
  if (!ran.ok) throw new Error(describeFailure(`docker ${args[0] ?? ""}`, ran))
  return ran
}

/** One command in the disks helper. */
export const inDisks = (
  target: Pick<DockerTarget, "socket">,
  argv: readonly string[],
): Promise<Ran> => docker(target, ["exec", DISKS_CONTAINER, ...argv])

export const imageExists = async (
  target: Pick<DockerTarget, "socket">,
  tag: string,
): Promise<boolean> =>
  (await docker(target, ["image", "inspect", "--format", "{{.Id}}", tag])).ok

/** Build `plan`'s image into Docker's store, from the host's CLI. */
export async function buildImage(
  target: Pick<DockerTarget, "socket">,
  plan: ImagePlan,
): Promise<void> {
  const ran = await docker(target, [
    "buildx",
    "build",
    "--load",
    "-t",
    plan.tag,
    ...plan.buildArgs.flatMap(a => ["--build-arg", a]),
    "-f",
    plan.file,
    path.dirname(plan.file),
  ])
  if (!ran.ok)
    throw new Error(`building ${plan.tag} failed: ${buildError(ran.stderr)}`)
}

/**
 * A failed build's cause: buildx's last `ERROR` line, else its last line.
 * Its first line only names the builder.
 */
export function buildError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  return (
    lines.findLast(l => /^ERROR\b|^error:/i.test(l)) ??
    lines.at(-1) ??
    "no message"
  )
}

export async function imagePath(
  target: Pick<DockerTarget, "socket">,
  tag: string,
): Promise<string> {
  const ran = await dockerOrThrow(target, [
    "image",
    "inspect",
    "--format",
    "{{json .Config.Env}}",
    tag,
  ])
  return parseImagePath(ran.stdout)
}

export const runInImage = (
  target: Pick<DockerTarget, "socket">,
  tag: string,
  argv: readonly string[],
): Promise<Ran<Uint8Array>> =>
  hostBytesRunner()([...dockerArgv(target), "run", "--rm", tag, ...argv])
