// docker/facts — what Docker and the lanes directory say, gathered.

import { readFile, stat } from "node:fs/promises"
import { type ContainerFacts, SPEC_LABEL } from "@pinetrie/lanes"
import { docker } from "./cli.ts"
import {
  type DockerHostFacts,
  type Listed,
  parseInspect,
  parseMountinfo,
  parsePs,
} from "./plan.ts"
import type { DockerTarget } from "./target.ts"

/** Whether Docker and buildx answer, and on Linux the lanes directory's filesystem. */
export async function gatherDockerHost(
  target: Pick<DockerTarget, "socket">,
  lanesDir: string | null,
): Promise<DockerHostFacts> {
  /** Null when the command answers, else the first line it printed. */
  const answers = async (args: readonly string[]) => {
    const ran = await docker(target, args)
    return ran.ok
      ? null
      : (`${ran.stderr}\n${ran.stdout}`
          .split("\n")
          .map(l => l.trim())
          .find(l => l !== "") ?? `exit ${ran.code}`)
  }
  const [up, buildx] = await Promise.all([
    answers(["version"]),
    answers(["buildx", "version"]),
  ])
  const mountinfo =
    lanesDir === null
      ? null
      : await readFile("/proc/self/mountinfo", "utf8").catch(() => "")
  return {
    platform: process.platform,
    docker: up,
    buildx,
    lanesDir:
      lanesDir === null || mountinfo === null
        ? null
        : { dir: lanesDir, fs: parseMountinfo(mountinfo, lanesDir) },
  }
}

/** A container's state and spec label; missing when it is not there. */
export async function containerFacts(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<ContainerFacts> {
  const ran = await docker(target, ["inspect", "--type", "container", name])
  return ran.ok
    ? parseInspect(ran.stdout, SPEC_LABEL)
    : { state: "missing", label: null }
}

/** Every container carrying `label`, running or not. */
export async function listLabelled(
  target: Pick<DockerTarget, "socket">,
  label: string,
): Promise<readonly Listed[]> {
  const ran = await docker(target, [
    "ps",
    "-a",
    "--filter",
    `label=${label}`,
    "--format",
    "{{json .}}",
  ])
  return ran.ok ? parsePs(ran.stdout) : []
}

/** Whether a path on the host exists. */
export const hostPathExists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  )
