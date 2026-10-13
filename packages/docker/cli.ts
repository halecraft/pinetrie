// docker/cli — the docker CLI, against the target's socket (`-H`), for what
// streams or builds: `buildx build`, `exec -i` (`dockerArgv`), a throwaway
// container's stdout as bytes, and the startup's check that the CLI and
// buildx answer. Everything else is Docker's API (`api.ts`).

import path from "node:path"
import { hostBytesRunner, type ImagePlan, type Ran, run } from "@pinetrie/lanes"
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
 * Build the machine role's image (the observer Containerfile's last stage),
 * its runtime and pine·trie's packages given as named contexts: it mounts
 * nothing from a host.
 */
export async function buildObserverImage(
  target: Pick<DockerTarget, "socket">,
  plan: {
    readonly file: string
    readonly tag: string
    /** The lane runtime, on the host. */
    readonly runtime: string
    /** pine·trie's `packages/`, on the host. */
    readonly packages: string
  },
): Promise<void> {
  const ran = await docker(target, [
    "buildx",
    "build",
    "--load",
    "-t",
    plan.tag,
    "--build-context",
    `runtime=${plan.runtime}`,
    "--build-context",
    `install=${plan.packages}`,
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

export const runInImage = (
  target: Pick<DockerTarget, "socket">,
  tag: string,
  argv: readonly string[],
): Promise<Ran<Uint8Array>> =>
  hostBytesRunner()([...dockerArgv(target), "run", "--rm", tag, ...argv])
