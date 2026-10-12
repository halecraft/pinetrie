// docker/facts — what Docker and the lanes directory say, gathered.

import { readFile, stat } from "node:fs/promises"
import { securityOptions } from "./api.ts"
import { docker } from "./cli.ts"
import { type DockerHostFacts, isRootless, parseMountinfo } from "./plan.ts"
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

export const hostPathExists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * Whether Docker runs rootless, as a nested lane's does: it says so in
 * `SecurityOptions`, and no capability it grants reaches the host's
 * user namespace, so `btrfs send` cannot run under it.
 */
export const dockerRootless = async (
  target: Pick<DockerTarget, "socket">,
): Promise<boolean> => isRootless(await securityOptions(target))
